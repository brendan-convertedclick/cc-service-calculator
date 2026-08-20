// Per-client meeting time, and the domain queue that makes it accurate.
//
// The hours come from client_meeting_hours (migration 0132), which counts
// PERSON-hours on meetings that have already happened: an hour with three of
// us in the room cost the agency three hours, and a meeting still in the
// diary has cost nothing yet.
//
// The queue is the other half. A meeting is attributed to a client by the
// email domain of whoever else was on the invite, and at the time this
// shipped only 3 of 37 clients had a domain mapped — so most meetings could
// not be attributed at all. Every domain resolved here makes the next sync
// (and every figure above it) better, which is why the two live on one page.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { callEdgeFn } from "@/lib/edge";

// Neither the view nor pending_meeting_domains is in the generated Database
// types — query untyped, same as useInternalMeetings does for the meeting
// tables themselves.
const sb = supabase as unknown as SupabaseClient;

const HOURS_KEY = ["client-meeting-hours"] as const;
const DOMAINS_KEY = ["pending-meeting-domains"] as const;

export interface ClientTimeRow {
  clientId: string;
  clientName: string;
  /** month (YYYY-MM) → person-hours */
  byMonth: Map<string, number>;
  totalHours: number;
  clientMeetingHours: number;
  internalMeetingHours: number;
  meetings: number;
}

export interface ClientTimeData {
  months: string[];
  rows: ClientTimeRow[];
  totalHours: number;
}

/** YYYY-MM for the last `count` months, oldest first. */
function recentMonths(count: number, from = new Date()): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(from.getFullYear(), from.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

interface HoursRow {
  client_id: string | null;
  month: string;
  meeting_type: "internal" | "client";
  source: "conductor" | "calendar";
  meetings: number;
  person_hours: number | string;
}

export function useClientMeetingHours(monthsBack = 6) {
  return useQuery({
    queryKey: [...HOURS_KEY, monthsBack],
    queryFn: async (): Promise<ClientTimeData> => {
      const months = recentMonths(monthsBack);
      const [hoursRes, clientsRes] = await Promise.all([
        sb.from("client_meeting_hours").select("*").gte("month", months[0]),
        sb.from("clients").select("id, name").is("archived_at", null),
      ]);
      if (hoursRes.error) throw hoursRes.error;
      if (clientsRes.error) throw clientsRes.error;

      const names = new Map(
        ((clientsRes.data ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
      );
      const byClient = new Map<string, ClientTimeRow>();

      for (const raw of (hoursRes.data ?? []) as HoursRow[]) {
        if (!raw.client_id) continue;
        const hours = Number(raw.person_hours) || 0;
        const row = byClient.get(raw.client_id) ?? {
          clientId: raw.client_id,
          clientName: names.get(raw.client_id) ?? "Unknown client",
          byMonth: new Map<string, number>(),
          totalHours: 0,
          clientMeetingHours: 0,
          internalMeetingHours: 0,
          meetings: 0,
        };
        row.byMonth.set(raw.month, (row.byMonth.get(raw.month) ?? 0) + hours);
        row.totalHours += hours;
        row.meetings += Number(raw.meetings) || 0;
        if (raw.meeting_type === "client") row.clientMeetingHours += hours;
        else row.internalMeetingHours += hours;
        byClient.set(raw.client_id, row);
      }

      const rows = [...byClient.values()].sort((a, b) => b.totalHours - a.totalHours);
      return {
        months,
        rows,
        totalHours: rows.reduce((s, r) => s + r.totalHours, 0),
      };
    },
  });
}

export interface PendingDomainRow {
  id: string;
  domain: string;
  seen_count: number;
  unattributed_hours: number;
  sample_title: string | null;
  sample_organiser_email: string | null;
  last_seen_at: string;
}

export function usePendingMeetingDomains() {
  return useQuery({
    queryKey: DOMAINS_KEY,
    queryFn: async (): Promise<PendingDomainRow[]> => {
      const { data, error } = await sb
        .from("pending_meeting_domains")
        .select("*")
        .is("ignored_at", null)
        .order("unattributed_hours", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PendingDomainRow[];
    },
  });
}

/**
 * Map a domain to a client: write the client_domains row the sync reads, then
 * drop it from the queue.
 *
 * The row is deleted rather than marked resolved — if the same domain ever
 * fails to resolve again, that is a real signal (the mapping was removed) and
 * it should come back, not stay silently ticked off.
 */
export function useMapDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ domain, clientId }: { domain: string; clientId: string }) => {
      // A plain insert, not an upsert: client_domains' unique index is on
      // lower(domain), an EXPRESSION index that ON CONFLICT cannot infer. It
      // is also the right behaviour — a domain only reaches this queue by
      // failing to resolve, so a conflict means someone mapped it a moment
      // ago and the operator should see that, not silently overwrite it.
      const { error } = await sb
        .from("client_domains")
        .insert({ client_id: clientId, domain: domain.toLowerCase() });
      if (error) throw error;
      const { error: delErr } = await sb.from("pending_meeting_domains").delete().eq("domain", domain);
      if (delErr) throw delErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DOMAINS_KEY });
    },
  });
}

/** Dismiss a domain that will never be a client — a supplier, a tool vendor. */
export function useIgnoreDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (domain: string) => {
      const { error } = await sb
        .from("pending_meeting_domains")
        .update({ ignored_at: new Date().toISOString() })
        .eq("domain", domain);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: DOMAINS_KEY }),
  });
}

export interface CalendarSyncResult {
  scanned: number;
  matched: number;
  created: number;
  updated: number;
  cancelled: number;
  tasks_created: number;
  skipped: Record<string, number>;
  pending_domains: Array<{ domain: string; meetings: number; hours: number }>;
  members: Array<{ member: string; events: number; error: string | null }>;
  errors: string[];
}

/**
 * Read everyone's calendar now.
 *
 * Resolving a domain does not retro-attribute the meetings that were skipped
 * for want of it — those events were passed over on an earlier pass and are
 * only picked up when the window is scanned again. So the sync button belongs
 * next to the queue, and a wide `days_back` is the way to catch up history.
 */
export function useSyncCalendars() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { days_back?: number; days_forward?: number; create_tasks?: boolean } = {}) =>
      callEdgeFn<CalendarSyncResult>("sync-calendar-meetings", args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOURS_KEY });
      qc.invalidateQueries({ queryKey: DOMAINS_KEY });
      qc.invalidateQueries({ queryKey: ["internal-meetings"] });
    },
  });
}
