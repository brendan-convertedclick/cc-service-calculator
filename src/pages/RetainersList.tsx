import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Plus, Trash2, RefreshCw, BookmarkPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useRetainers,
  useDeleteRetainer,
  useSetRetainerInternal,
  isInternalRetainer,
  type RetainerListRow,
} from "@/hooks/useRetainers";
import { currentMonthKey } from "@/hooks/usePulseRetainerBurn";
import { useSyncActuals } from "@/hooks/useSyncActuals";
import {
  useRetainerAllocation,
  HOURS_PER_POINT,
  type AllocationRow,
  type DeliveryItem,
} from "@/hooks/useRetainerAllocation";
import { RetainerSubItems } from "@/components/retainers/RetainerSubItems";
import { supabase } from "@/lib/supabase";
import { useSaveRetainerTemplate, type TemplateShape } from "@/hooks/useRetainerTemplates";
import {
  useAdhocInvoices,
  billingKey,
  impliedRateCents,
  type ClientMonthBilling,
} from "@/hooks/useAdhocInvoices";
import { formatZar, cn, errorMessage } from "@/lib/utils";
import { todayISO } from "@/lib/dates";
import { STATUS_LABEL } from "@/lib/project-status";
import { retainerStatus, STATUS_LABEL as DELIVERY_LABEL, type RetainerStatus } from "@/lib/retainer-status";

// The stored project_status enum uses "completed"/"in_progress"; DerivedStatus
// uses "complete". Normalise both so the badge never shows a raw lowercase token.
const RAW_STATUS_LABEL: Record<string, string> = {
  in_progress: "In progress",
  completed: "Complete",
  cancelled: "Cancelled",
  archived: "Archived",
  backlog: "Backlog",
};

function statusLabel(status: string): string {
  return (
    RAW_STATUS_LABEL[status] ??
    (STATUS_LABEL as Record<string, string>)[status] ??
    status
  );
}

// Active retainers pop (success), finished/inactive ones recede (muted) — same
// convention as ServicesList (active → success). Reserved gradient stays off status.
function statusVariant(status: string): "success" | "muted" | "outline" {
  if (status === "in_progress" || status === "active") return "success";
  if (status === "backlog" || status === "to do") return "outline";
  return "muted"; // complete, completed, cancelled, archived, closed, done
}

function fmtHours(n: number): string {
  return n ? `${Math.round(n * 10) / 10}h` : "—";
}

/** Red in BOTH directions: over-delivery is a margin problem, not a win. */
// Judged against Planned — what the fee buys. It used to be judged against the
// recurring schedule, which is why Kings College read as a red flag: 19.3 of its
// 22.8 planned hours are on a retainer with no recurring tasks at all, so the
// schedule said 2.3h and the colour called a normal month a disaster.
// The three categories Lisa asked for, plus the two shapes that are neither a
// budgeted retainer nor ad hoc and would otherwise have nowhere to go.
const CATEGORY_LABEL: Record<AllocationRow["kind"], string> = {
  retainer: "Retainer",
  adhoc: "Ad hoc",
  internal: "Internal",
  unlinked: "No retainer",
  fixed: "Fixed price",
};

// What the Completed number is made of. Since 0160 it adds two halves —
// closed briefs and closed recurring tasks — and values each at its logged
// time where anyone logged it and its estimate where nobody did. A total that
// silently mixes those is a number nobody can defend on a client call, so the
// breakdown sits one hover away rather than nowhere.
function completedTitle(a: AllocationRow | undefined): string | undefined {
  if (!a || a.deliveredItems === 0) return undefined;
  const estimated = a.deliveredItems - a.measuredItems;
  const coverage =
    a.measuredItems === a.deliveredItems
      ? "all with time logged"
      : a.measuredItems === 0
        ? "none with time logged — all estimated"
        : `${a.measuredItems} with time logged, ${estimated} estimated`;
  const parts = [
    `${a.deliveredItems} item${a.deliveredItems === 1 ? "" : "s"} closed · ${coverage}`,
  ];
  if (a.recurringHours > 0) parts.push(`${fmtHours(a.recurringHours)} of it recurring tasks`);
  return parts.join(" · ");
}

// What the Invoiced cell says, and what its hover explains. An accepted quote
// is shown apart from invoiced money: the work is being done against it, so it
// belongs in the rate, but it has not been billed and must never be added to
// revenue (0164).
function invoicedCell(b: ClientMonthBilling | undefined, completedHours: number): string {
  if (!b || (b.invoicedNetCents === 0 && b.quotedNetCents === 0)) return "—";
  const rate = impliedRateCents(b, completedHours);
  const money = formatZar(b.invoicedNetCents + b.quotedNetCents);
  return rate == null ? money : `${money} · ${formatZar(rate)}/h`;
}

function billingTitle(b: ClientMonthBilling | undefined, completedHours: number): string | undefined {
  if (!b || b.docs.length === 0) return undefined;
  const parts = b.docs
    .map((d) => `${d.number ?? "(no number)"}${d.kind === "quote" ? " (quote, not yet invoiced)" : ""} — ${formatZar(d.netCents)} net, ${d.issuedOn}`);
  const rate = impliedRateCents(b, completedHours);
  if (rate != null) {
    parts.push(`${fmtHours(completedHours)} completed → ${formatZar(rate)} an hour`);
  }
  return parts.join("\n");
}

// BRIEFED — work that came in as a brief, as against Scheduled, which is the
// work that repeats every month on its own. The two are the ways work reaches
// us, and Completed is whatever closed out of either, so the three read left to
// right as: what repeats, what was asked for, what got done.
//
// Derived rather than stored: deliveredHours minus its recurring share is the
// brief part that closed, and openPoints is the brief part still running (only
// briefs are ever counted as open). Nothing new has to be queried for it.
function briefedHoursOf(a: AllocationRow): number {
  return a.deliveredHours - a.recurringHours + a.openPoints * HOURS_PER_POINT;
}

function deliveryVariant(s: RetainerStatus): "default" | "secondary" | "destructive" | "outline" {
  // Over is the one that costs money, so it is the one that shouts.
  if (s === "over") return "destructive";
  if (s === "under") return "outline";
  return "secondary";
}

// What the retainer still has to deliver this month: Planned minus Completed,
// floored at zero. Lisa, 2026-09-16: "Still Due should be the hours of work
// based on the retainer, so Planned minus Completed". Completed used to carry
// the open work as a "+5.5h" tag in the same cell, coloured by how far behind
// it was, and read as messy; the Status badge is where over/under lives, so
// Completed is a plain number and this is its own column. On a tab with no
// Planned column the basis is Scheduled, the same rule the Status badge uses.
// No basis at all (ad hoc, internal lumps) is a dash, not a zero.
function stillDue(basis: number, completed: number): number | null {
  if (basis <= 0) return null;
  return Math.max(0, basis - completed);
}

function stillDueCell(basis: number, completed: number): string {
  const v = stillDue(basis, completed);
  return v == null ? "—" : fmtHours(v);
}

function stillDueTitle(basis: number, completed: number, basisLabel: string): string | undefined {
  if (basis <= 0) return undefined;
  return `${fmtHours(basis)} ${basisLabel}, ${fmtHours(completed)} completed`;
}

// Client is the group header; every row is a retainer — so strip the redundant
// "{Client} … Retainer" boilerplate from the name and show only the differentiator.
function displayRetainerName(name: string, clientName: string | null): string {
  let n = (name ?? "").trim();
  const client = (clientName ?? "").trim();
  if (client && n.toLowerCase().startsWith(client.toLowerCase())) {
    n = n.slice(client.length).trim();
  }
  n = n.replace(/\s*retainer\s*$/i, "").trim();
  return n || name; // never render empty
}

// The column key (Lisa, 2026-09-08). Every definition here also lives in a
// `title` on its column header, which is invisible on a touch device and
// invisible to anyone who does not think to hover — and these four words mean
// specific things that the team has to agree on, not guess at. Native
// <details> so it collapses with no state to manage; open by default, because a
// key nobody opens is a key nobody reads.
//
// It follows the columns rather than listing all of them: the Internal tab has
// no fee and no Planned, and explaining a column that is not on screen is how a
// key stops being trusted.
function ColumnKey({
  showFee,
  showPlanned,
  showScheduled,
  showBriefed,
  showInvoiced,
}: {
  showFee: boolean;
  showPlanned: boolean;
  showScheduled: boolean;
  showBriefed: boolean;
  showInvoiced: boolean;
}) {
  const terms: Array<[string, string]> = [
    ...(showFee ? [["Monthly fee", "What the client is invoiced each month."] as [string, string]] : []),
    ...(showPlanned
      ? [["Planned", "The hours that fee buys at our standard rate. A pricing fact, not a promise about this particular month."] as [string, string]]
      : []),
    ...(showInvoiced
      ? [["Invoiced", "What was actually charged for this client's ad hoc work this month, ex-VAT, with what that works out to an hour beside it. Invoices issued in the month plus any accepted quote not yet billed — hover for the documents behind it."] as [string, string]]
      : []),
    ...(showScheduled
      ? [["Scheduled", "The recurring tasks actually created for this month — the reports, plugin sweeps and standing meetings. Not what the setup adds up to on paper: what got made."] as [string, string]]
      : []),
    ...(showBriefed
      ? [["Briefed", "Work someone asked for this month — the briefs that closed plus the ones still running. Scheduled repeats on its own; this is the work that had to be requested."] as [string, string]]
      : []),
    [
      "Completed",
      "What actually closed this month, scheduled tasks and briefs both. Each one counts its logged time where somebody tracked it and its estimate where nobody did — hover any figure for the split.",
    ],
    [
      "Still due",
      `What the retainer still has to deliver this month: ${showPlanned ? "Planned" : "Scheduled"} minus Completed, never below zero. A dash means there is no ${showPlanned ? "planned" : "scheduled"} figure to measure against.`,
    ],
    [
      "Under · On track · Over",
      // The badge follows whichever basis the tab shows, so the key has to say
      // which one — an Under measured against a column that is not on screen is
      // the thing this whole key exists to prevent.
      `Completed measured against ${showPlanned ? "Planned" : "Scheduled"}, judged on the share of the month that has actually passed — so nothing reads as behind on the 2nd.`,
    ],
  ];

  return (
    <details className="mb-4 rounded-md border border-m-outline-variant bg-m-surface-container-low px-4 py-2" open>
      <summary className="cursor-pointer text-label-large text-m-on-surface-variant">
        What these columns mean
      </summary>
      <dl className="mt-2 grid gap-x-8 gap-y-2 sm:grid-cols-2">
        {terms.map(([term, meaning]) => (
          <div key={term}>
            <dt className="text-label-large text-m-on-surface">{term}</dt>
            <dd className="text-label-small text-m-on-surface-variant">{meaning}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

// What an Ad Hoc or Internal row is actually made of. The retainer rows have
// always opened to their provisioned tasks (RetainerSubItems); these rows are
// briefs, so they had nothing to open — which left "Ad hoc — invoiced
// separately · 8.6h" as a number with no way to ask what it was.
//
// Newest first: the question being asked is "what came in", and the most recent
// thing is the most likely thing you are looking for. Still-open work sorts to
// the top of that, because it is the half you can still do something about.
function DeliveryItems({ items }: { items: DeliveryItem[] }) {
  const sorted = [...items].sort((a, b) => {
    if (!a.completedAt && b.completedAt) return -1;
    if (a.completedAt && !b.completedAt) return 1;
    return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-12">Task</TableHead>
          <TableHead className="whitespace-nowrap text-right">Hours</TableHead>
          <TableHead className="whitespace-nowrap">Due</TableHead>
          <TableHead className="whitespace-nowrap">Closed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((it) => (
          <TableRow key={it.id} className="[&>td]:py-2">
            <TableCell className="pl-12 text-body-medium text-m-on-surface">{it.name}</TableCell>
            <TableCell
              className="whitespace-nowrap text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant"
              // Same rule as the Completed column: logged time where somebody
              // logged it, the estimate where nobody did. Saying which matters
              // more here than in a total, because one row is one person's work.
              title={it.measured ? "Time logged on the task" : "Estimated — nobody logged time"}
            >
              {fmtHours(it.hours)}
              {!it.measured && it.hours > 0 && (
                <span className="ml-1 text-label-small font-normal text-m-on-surface-variant">est</span>
              )}
            </TableCell>
            {/* The month filter keeps anything due BY the end of the month you
                picked, so an overdue item from June still appears in September.
                This column is what stops that reading as September's work. */}
            <TableCell
              className={cn(
                "whitespace-nowrap text-label-small",
                !it.completedAt && it.dueDate && it.dueDate.slice(0, 10) < todayISO()
                  ? "text-m-error"
                  : "text-m-on-surface-variant",
              )}
            >
              {it.dueDate ? it.dueDate.slice(0, 10) : "No date"}
            </TableCell>
            <TableCell className="whitespace-nowrap text-label-small text-m-on-surface-variant">
              {it.completedAt ? it.completedAt.slice(0, 10) : "Still open"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// The per-retainer Internal switch (0162) — the same control, wording and shape
// as the "Internal project" switch on a staff brief, because it answers the
// same question and people should not have to learn it twice.
//
// A client's own brand cannot be un-flagged from here: internal is the OR of
// the client's flag and this one, so for Pebble or The Media Mixology the
// switch would do nothing. It says so rather than offering a control that
// silently no-ops.
function InternalSwitch({ retainer }: { retainer: RetainerListRow }) {
  const setInternal = useSetRetainerInternal();
  const fixedByClient = retainer.client_is_internal;
  const on = isInternalRetainer(retainer);
  const id = `retainer-internal-${retainer.id}`;

  return (
    <div className="flex items-center justify-between gap-4 border-b border-m-outline-variant px-12 py-3">
      <div>
        <Label htmlFor={id} className="text-body-medium text-m-on-surface">
          Internal work
        </Label>
        <p className="text-label-small text-m-on-surface-variant">
          {fixedByClient
            ? `${retainer.client_name} is one of our own brands, so all of its work is internal.`
            : "Off = client work · On = our own cost, moved to the Internal tab and out of every client total"}
        </p>
      </div>
      <Switch
        id={id}
        checked={on}
        disabled={fixedByClient || setInternal.isPending}
        onCheckedChange={(next) =>
          setInternal.mutate(
            { id: retainer.id, isInternal: next },
            {
              onSuccess: () =>
                toast.success(
                  next
                    ? `“${retainer.name}” moved to Internal`
                    : `“${retainer.name}” moved back to the client book`,
                ),
              onError: (err) => toast.error(`Could not change this: ${errorMessage(err)}`),
            },
          )
        }
      />
    </div>
  );
}

export function RetainersList() {
  const navigate = useNavigate();
  const { data: retainers = [] } = useRetainers();
  const deleteRetainer = useDeleteRetainer();
  // includeCompleted: a retainer that has completed must still show its
  // consumed hours here (Pulse keeps the default in-progress-only view).
  const [month, setMonth] = useState(() => currentMonthKey());
  const sync = useSyncActuals();
  const saveTemplate = useSaveRetainerTemplate();

  // Capture a retainer's shape for reuse (0166). Reads the services straight
  // off the retainer rather than asking for them again — the whole point is
  // that the shape already exists and is being retyped elsewhere.
  async function handleSaveTemplate(projectId: string, retainerName: string) {
    const name = window.prompt(
      "Name this template — it will appear when creating a new retainer.",
      retainerName.replace(/\s*retainer\s*$/i, "").trim(),
    );
    if (!name) return;
    const { data, error } = await supabase
      .from("retainer_recurring_services")
      .select(
        "service_id, cadence, occurrences_per_month, points_per_occurrence, is_live_eligible, occurrence_labels, occurrence_start_days, occurrence_due_days, label_as_task_name, roll_up_monthly, recur_weekday, task_description, checklist_items",
      )
      .eq("project_id", projectId)
      .is("paused_at", null);
    if (error) {
      toast.error(`Could not read this retainer's services: ${errorMessage(error)}`);
      return;
    }
    saveTemplate.mutate(
      {
        name,
        isInternal: retainers.find((r) => r.id === projectId)
          ? isInternalRetainer(retainers.find((r) => r.id === projectId)!)
          : false,
        services: ((data ?? []) as Array<Partial<TemplateShape> & {
          service_id: string;
          cadence: string | null;
          occurrences_per_month: number | null;
          points_per_occurrence: number | null;
          is_live_eligible: boolean | null;
        }>).map((s) => ({
          service_id: s.service_id,
          cadence: s.cadence ?? "monthly",
          occurrences_per_month: Number(s.occurrences_per_month ?? 1),
          points_per_occurrence: Number(s.points_per_occurrence ?? 1),
          is_live_eligible: !!s.is_live_eligible,
          // The timing half (0167). Capturing the services without it saves a
          // template that applies as undated tasks and looks like it worked.
          occurrence_labels: s.occurrence_labels ?? [],
          occurrence_start_days: s.occurrence_start_days ?? [],
          occurrence_due_days: s.occurrence_due_days ?? [],
          label_as_task_name: s.label_as_task_name ?? false,
          roll_up_monthly: s.roll_up_monthly ?? false,
          recur_weekday: s.recur_weekday ?? null,
          task_description: s.task_description ?? null,
          checklist_items: s.checklist_items ?? [],
        })),
      },
      {
        onSuccess: () => toast.success(`Saved "${name}" as a template`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  // Group by client (alphabetical), then by retainer name within each client.
  const sortedRetainers = useMemo(
    () =>
      [...retainers].sort(
        (a, b) =>
          (a.client_name ?? "").localeCompare(b.client_name ?? "") ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      ),
    [retainers],
  );

  // Collapse the repeated Client column into real per-client groups, each with a
  // count + monthly-fee total so the operator doesn't eyeball-sum the column.
  // Sold / Committed / Delivered come from the allocation model, not from
  // project_actuals. project_actuals only ever counted provisioned tasks, which
  // is why this page read 0 hours used on retainers carrying dozens of briefs.
  const { data: allocMonths = [] } = useRetainerAllocation();
  const { data: billing } = useAdhocInvoices();
  const billingFor = (clientId: string | null): ClientMonthBilling | undefined =>
    clientId ? billing?.get(billingKey(clientId, month)) : undefined;
  const alloc = useMemo(() => {
    const m = allocMonths.find((x) => x.month === month) ?? allocMonths[0];
    return new Map((m?.rows ?? []).filter((r) => r.projectId).map((r) => [r.projectId!, r]));
  }, [allocMonths, month]);

  // Every line the month produced that is NOT one of the retainers listed
  // above: ad hoc work, retainer work with no retainer to hang off, our own
  // brands, and fixed-price projects. These used to be a parenthetical on the
  // client header — "(8h off-retainer)" — which is how a whole category of
  // work stayed invisible. They are rows now, one per category per client.
  const extrasByClient = useMemo(() => {
    const m = allocMonths.find((x) => x.month === month) ?? allocMonths[0];
    const retainerIds = new Set(retainers.map((r) => r.id));
    const byClient = new Map<string, AllocationRow[]>();
    for (const r of m?.rows ?? []) {
      if (r.projectId && retainerIds.has(r.projectId)) continue;
      if (r.deliveredHours <= 0 && r.openPoints <= 0) continue;
      (byClient.get(r.clientName) ?? byClient.set(r.clientName, []).get(r.clientName)!).push(r);
    }
    return byClient;
  }, [allocMonths, month, retainers]);

  const clientGroups = useMemo(() => {
    const map = new Map<string, typeof sortedRetainers>();
    for (const r of sortedRetainers) {
      const key = r.client_name ?? "—";
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    // OUR OWN BRANDS ARE THE EXCEPTION to the rule below, and they have to be:
    // we do not invoice ourselves, so most of them have no retainer record at
    // all and never formed a group — which silently deleted most of the
    // Internal tab. The Conductor (48 briefs, 6.5h in September), Granite (21),
    // Quartz, Slate and Flint were all missing; only Pebble, The Converted
    // Click and The Media Mixology showed, and only because someone happened to
    // create retainer rows for them. An empty group is enough: the client tabs
    // all require retainer rows to render, so seeding one here reaches the
    // Internal tab and nowhere else.
    for (const [clientName, rows] of extrasByClient) {
      if (map.has(clientName)) continue;
      if (rows.some((r) => r.isInternal)) map.set(clientName, []);
    }
    // A PAYING client is still never seeded that way. Lisa: "I want to keep
    // Retainers strictly to invoiced items." A client with ad hoc work and no
    // retainer — A Love Supreme — is not a retainer client; their work still
    // lives in Briefs and in ClickUp, it is just not measured here. The rule
    // is about the client book, which is why the loop above can carve our own
    // brands out of it without contradicting it.
    return [...map.entries()].map(([clientName, allRows]) => {
      const extras = extrasByClient.get(clientName) ?? [];
      // A retainer with neither a fee nor an hours target is the open shape —
      // Trellidor's ad hoc one. Its work is already counted on the client's Ad
      // hoc line, so showing the project too would print it twice.
      const rows = allRows.filter(
        (r) => r.retainer_monthly_fee_cents != null || r.retainer_hours_target != null,
      );
      // Real recurring work that no invoice covers: plugin updates carried by
      // the hosting fee, meetings we do not charge for. Kept visible, with
      // what pays for it, but out of the retainer book — 10 planned hours a
      // month against zero revenue is exactly what distorted the numbers.
      // A standing monthly task is not a retainer engagement (0154): still
      // provisioned every month, but it answers "is this getting done", not
      // "is this client's retainer being serviced".
      //
      // Internal comes off FIRST and beats everything else (0162). It used to
      // be a whole-client fact, so a group was internal or it was not; a
      // retainer can now be flagged on its own, which means one client can
      // appear on both books — a real invoice on the client tab and the line
      // nobody charges for on the internal one. One rule, so it stays
      // explainable: flagged internal, and the row is internal, whatever else
      // it is. For a client of ours that is one of our brands every row lands
      // here anyway, which is why the tabs below no longer need to ask.
      const internalRows = rows.filter(isInternalRetainer);
      const clientSide = rows.filter((r) => !isInternalRetainer(r));
      const recurring = clientSide.filter((r) => r.is_recurring_task);
      const retainerRows = clientSide.filter((r) => !r.is_recurring_task);
      const billed = retainerRows.filter((r) => (r.retainer_monthly_fee_cents ?? 0) > 0);
      const unbilled = retainerRows.filter((r) => (r.retainer_monthly_fee_cents ?? 0) === 0);
      return {
      clientName,
      // Any row of the group will do — they are all this client's.
      clientId:
        allRows[0]?.client_id ?? extras.find((e) => e.clientId)?.clientId ?? null,
      // The CLIENT's flag (0152), not the row's — it is what routes the
      // client-level extras (ad hoc and unlinked briefs), which hang off a
      // client and have no retainer to be flagged on. Per-retainer internal
      // lives in `internalRows`.
      isInternal: allRows[0]?.client_is_internal ?? extras[0]?.isInternal ?? false,
      rows: billed,
      unbilled,
      recurring,
      internalRows,
      extras,
      totalFeeCents: billed.reduce(
        (sum, r) => sum + (r.retainer_monthly_fee_cents ?? 0),
        0,
      ),
      // Planned and Scheduled are the retainer book: what a fee bought and what
      // is set up to repeat for it. Unbilled work has hours but no fee, so it
      // belongs in neither total.
      sold: billed.reduce((sum, r) => sum + (alloc.get(r.id)?.soldHours ?? 0), 0),
      committed: billed.reduce((sum, r) => sum + (alloc.get(r.id)?.committedHours ?? 0), 0),
      // Completed counts everything: work done is work done, whoever paid.
      delivered:
        retainerRows.reduce((sum, r) => sum + (alloc.get(r.id)?.deliveredHours ?? 0), 0) +
        extras.reduce((sum, r) => sum + r.deliveredHours, 0),
      };
    });
  }, [sortedRetainers, alloc, extrasByClient]);

  // One shape, four books. Every tab takes the same client groups and keeps a
  // different slice of their rows — and recomputes the totals from that slice
  // rather than carrying the client group's, which is how the Recurring tab
  // came to print Trellidor's R59,637 above four standing tasks worth nothing.
  const asSection = useMemo(() => {
    const hours = (rows: RetainerListRow[], pick: (a: AllocationRow) => number) =>
      rows.reduce((n, r) => {
        const a = alloc.get(r.id);
        return n + (a ? pick(a) : 0);
      }, 0);
    return (
      g: (typeof clientGroups)[number],
      part: { rows?: RetainerListRow[]; unbilled?: RetainerListRow[]; extras?: AllocationRow[] },
    ) => {
      const rows = part.rows ?? [];
      const unbilled = part.unbilled ?? [];
      const extras = part.extras ?? [];
      return {
        clientName: g.clientName,
        clientId: g.clientId,
        isInternal: g.isInternal,
        rows,
        unbilled,
        recurring: [] as RetainerListRow[],
        extras,
        totalFeeCents: rows.reduce((n, r) => n + (r.retainer_monthly_fee_cents ?? 0), 0),
        // Planned and Scheduled are what a fee bought and what repeats for it.
        // Unbilled work has hours and no fee, so it is in neither.
        sold: hours(rows, (a) => a.soldHours),
        committed: hours(rows, (a) => a.committedHours),
        // Completed counts everything on the tab: work done is work done.
        delivered:
          hours([...rows, ...unbilled], (a) => a.deliveredHours) +
          extras.reduce((n, x) => n + x.deliveredHours, 0),
        briefed:
          hours([...rows, ...unbilled], briefedHoursOf) +
          extras.reduce((n, x) => n + briefedHoursOf(x), 0),
      };
    };
  }, [alloc]);

  const sections = useMemo(() => {
    const totals = (groups: ReturnType<typeof asSection>[]) => ({
      fee: groups.reduce((n, g) => n + g.totalFeeCents, 0),
      sold: groups.reduce((n, g) => n + g.sold, 0),
      committed: groups.reduce((n, g) => n + g.committed, 0),
      delivered: groups.reduce((n, g) => n + g.delivered, 0),
      briefed: groups.reduce((n, g) => n + g.briefed, 0),
      // Summed from the same per-client lookup the rows use, so the total can
      // never disagree with the rows under it.
      invoicedCents: groups.reduce((n, g) => {
        const b = billingFor(g.clientId);
        return n + (b ? b.invoicedNetCents + b.quotedNetCents : 0);
      }, 0),
    });
    // A client belongs on the retainer tab only if they hold a retainer. Ad hoc
    // work alone does not put them there — OracleMed's plugin line became a
    // standing task, so their ad hoc briefs would otherwise have walked them
    // straight back onto the page Lisa had just taken them off.
    const clientRetainers = clientGroups
      .filter((g) => !g.isInternal && g.rows.length + g.unbilled.length > 0)
      .map((g) => asSection(g, { rows: g.rows, unbilled: g.unbilled }));
    // Everything a client had that no retainer covers. Each row carries its own
    // category badge, so a fixed-price project and retainer work with no
    // retainer sit here too rather than having a tab each.
    const adhoc = clientGroups
      .filter((g) => !g.isInternal && g.extras.length > 0)
      .map((g) => asSection(g, { extras: g.extras }));
    // Our own work, apart from the client book — a month is judged on the
    // client half, and summing the two flatters every ratio on the page. Our
    // own brands land here whole; a paying client lands here only for the
    // rows somebody flagged (0162), and keeps its invoice on the tab above.
    const internal = clientGroups
      .filter((g) => g.internalRows.length > 0 || (g.isInternal && g.extras.length > 0))
      .map((g) => asSection(g, { rows: g.internalRows, extras: g.isInternal ? g.extras : [] }));
    // Standing monthly tasks. Their fee is a real monthly invoice: out of the
    // retainer book, not out of the accounts.
    const recurring = clientGroups
      .filter((g) => g.recurring.length > 0)
      .map((g) => asSection(g, { rows: g.recurring }));
    return [
      { key: "client" as const, label: "Client Retainers", groups: clientRetainers, ...totals(clientRetainers) },
      { key: "adhoc" as const, label: "Ad Hoc", groups: adhoc, ...totals(adhoc) },
      { key: "internal" as const, label: "Internal", groups: internal, ...totals(internal) },
      { key: "recurring" as const, label: "Recurring", groups: recurring, ...totals(recurring) },
    ];
  }, [clientGroups, asSection]);

  const [tab, setTab] = useState<"client" | "adhoc" | "internal" | "recurring">("client");
  const section = sections.find((s) => s.key === tab) ?? sections[0];
  // The Internal tab answers a different question, so it gets a different set
  // of columns (Lisa, 2026-09-08). Monthly fee and Planned are both facts about
  // an invoice — a notional fee we pay ourselves, and the hours that fee buys —
  // and on our own work there is no invoice, so a whole column of dashes was
  // standing in for a question nobody was asking. Scheduled stays: the standing
  // tasks are real either way. Briefed joins it, because with the two money
  // columns gone the row needs to say where the work came from.
  // Recurring joins Internal in dropping both (Lisa, 2026-09-09): "these are
  // tasks I see as need to be done but there is not a fixed price on an
  // invoice." Some standing items do carry a small fee, but the tab is not
  // asking whether a fee was serviced — it asks whether the thing got done, and
  // two columns of invoice arithmetic beside that question is noise.
  const showFee = tab !== "internal" && tab !== "recurring" && tab !== "adhoc";
  const showPlanned = tab !== "internal" && tab !== "recurring" && tab !== "adhoc";
  // Ad hoc work is never scheduled — nobody sets a recurring task for a one-off
  // — so that column was a third of dashes beside the two invoice ones. Same
  // reasoning Lisa applied to Recurring: a column that never varies is noise.
  const showScheduled = tab !== "adhoc";
  // INVOICED (0164) replaces them: what was actually charged, net, against the
  // hours beside it. It is per CLIENT per month, so it sits on the client row
  // and not on the ad hoc / no-retainer lines beneath — an invoice does not
  // divide between them, and printing it on both would count it twice.
  const showInvoiced = tab === "adhoc";
  // Briefed joins the client tab too (Lisa, 2026-09-08). It is what turns
  // Trellidor's row from "nothing happened" into "nothing was even asked for
  // against this retainer" — Planned 49.2h, Scheduled 13.5h, Briefed 0h. Not on
  // Ad Hoc or Recurring: everything on the first is briefed by definition and
  // nothing on the second is, so both would print a column that never varies.
  const showBriefed = tab === "internal" || tab === "client";
  // Six columns every tab has — chevron, Name, Completed, Still due, Status and
  // the trailing actions cell — plus whichever optional ones this tab shows.
  // The expanded panel spans it, and a wrong count leaves a white step down the
  // right of every open row.
  const columnCount =
    6 + Number(showFee) + Number(showPlanned) + Number(showScheduled) +
    Number(showBriefed) + Number(showInvoiced);


  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Clients start closed: the point of the page is the rollup, with the
  // retainers behind it a click away rather than a wall on arrival.
  const [openClients, setOpenClients] = useState<Record<string, boolean>>({});

  function toggleExpanded(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function handleSync(projectId?: string, label?: string) {
    sync.mutate(projectId, {
      onSuccess: () => toast.success(label ? `Synced ${label}` : "Synced all retainers"),
      onError: (err) => toast.error(`Sync failed: ${errorMessage(err)}`),
    });
  }

  return (
    <div className="flex h-full">
      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h1 className="text-headline-medium">Retainers</h1>
          <div className="flex items-center gap-2">
            <input
              type="month"
              aria-label="Select month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-10 rounded-md border border-m-outline-variant bg-transparent px-3 py-1.5 text-body-small text-m-on-surface"
            />
            <Button
              variant="outline"
              onClick={() => handleSync(undefined)}
              disabled={sync.isPending}
            >
              <RefreshCw
                className={cn("h-4 w-4", sync.isPending && sync.variables === undefined && "animate-spin")}
              />
              Sync all
            </Button>
            <Button onClick={() => navigate("/retainers/new")}>
              <Plus className="h-4 w-4" />
              New retainer
            </Button>
          </div>
        </div>

        {/* Client work and our own brands are two different books. A tab keeps
            the page answering one question at a time. */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "client" | "adhoc" | "internal" | "recurring")}
          className="mb-4"
        >
          <TabsList>
            {sections.map((sec) => (
              <TabsTrigger key={sec.key} value={sec.key}>
                {sec.label}
                <span className="ml-2 text-label-small text-m-on-surface-variant">
                  {fmtHours(sec.delivered)}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <ColumnKey
          showFee={showFee}
          showPlanned={showPlanned}
          showScheduled={showScheduled}
          showBriefed={showBriefed}
          showInvoiced={showInvoiced}
        />

        {retainers.length === 0 ? (
          <div className="text-body-medium text-m-on-surface-variant">
            No retainers yet. Create one with the “New retainer” button to set up monthly hours,
            a fee, and recurring services.
          </div>
        ) : clientGroups.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-px" />
                    <TableHead>Name</TableHead>
                    {showFee && <TableHead className="whitespace-nowrap text-right">Monthly fee</TableHead>}
                    {showPlanned && (
                      <TableHead className="whitespace-nowrap text-right" title="What the monthly fee buys at the standard rate">Planned</TableHead>
                    )}
                    {showInvoiced && (
                      <TableHead className="whitespace-nowrap text-right" title="What was actually charged for this client's ad hoc work this month, ex-VAT — the invoices issued in the month, plus any accepted quote not yet invoiced. Retainer fees are net too, so the two compare honestly.">Invoiced</TableHead>
                    )}
                    {showScheduled && (
                      <TableHead className="whitespace-nowrap text-right" title="The recurring tasks actually created for this month — what the provisioner made, not what the recurring-services setup adds up to. Work briefed ad hoc is not scheduled and does not appear here.">Scheduled</TableHead>
                    )}
                    {showBriefed && (
                      <TableHead className="whitespace-nowrap text-right" title="Work that came in as a brief this month — the closed ones plus whatever is still running. Scheduled is the work that repeats on its own; this is the work someone asked for.">Briefed</TableHead>
                    )}
                    <TableHead className="whitespace-nowrap text-right" title="Work that actually closed this month — briefs and recurring tasks both, valued at logged time where anyone logged it and at the estimate where nobody did. Hover a number for the split.">Completed</TableHead>
                    <TableHead className="whitespace-nowrap text-right" title={`${showPlanned ? "Planned" : "Scheduled"} minus Completed: what the retainer still has to deliver this month.`}>Still due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-px" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                    <Fragment key={section.key}>
                    {/* The tab's own totals, on the row above its clients. */}
                    {(
                      <TableRow className="hover:bg-transparent">
                        <TableCell className="w-px bg-m-surface-container pb-1 pt-4" />
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-label-large uppercase tracking-wide text-m-on-surface-variant">
                          {section.label}
                        </TableCell>
                        {showFee && (
                          <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface">
                            {section.fee > 0 ? formatZar(section.fee) : "—"}
                          </TableCell>
                        )}
                        {showPlanned && (
                          <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(section.sold)}
                          </TableCell>
                        )}
                        {showInvoiced && (
                          <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface">
                            {section.invoicedCents > 0 ? formatZar(section.invoicedCents) : "—"}
                          </TableCell>
                        )}
                        {showScheduled && (
                          <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(section.committed)}
                          </TableCell>
                        )}
                        {showBriefed && (
                          <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(section.briefed)}
                          </TableCell>
                        )}
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface">
                          {fmtHours(section.delivered)}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4 text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                          {stillDueCell(showPlanned ? section.sold : section.committed, section.delivered)}
                        </TableCell>
                        <TableCell className="bg-m-surface-container pb-1 pt-4" />
                        <TableCell className="bg-m-surface-container pb-1 pt-4" />
                      </TableRow>
                    )}
                    {section.groups.map((group) => (
                    <Fragment key={group.clientName}>
                      <TableRow
                        role="button"
                        tabIndex={0}
                        aria-expanded={!!openClients[group.clientName]}
                        aria-label={`${openClients[group.clientName] ? "Hide" : "Show"} retainers for ${group.clientName}`}
                        className="cursor-pointer hover:bg-m-surface-container"
                        onClick={() =>
                          setOpenClients((p) => ({ ...p, [group.clientName]: !p[group.clientName] }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setOpenClients((p) => ({ ...p, [group.clientName]: !p[group.clientName] }));
                          }
                        }}
                      >
                        <TableCell className="w-px border-b border-m-outline-variant bg-m-surface-container-low pr-0">
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 text-m-on-surface-variant transition-transform",
                              openClients[group.clientName] && "rotate-90",
                            )}
                          />
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low py-2">
                          <span className="text-title-small font-semibold text-m-on-surface">
                            {group.clientName}
                          </span>
                          <span className="ml-2 text-label-small text-m-on-surface-variant">
                            {(() => {
                              // Count what is actually on this tab, and only
                              // call them retainers where they are retainers.
                              const n =
                                group.rows.length + group.unbilled.length + group.extras.length;
                              const noun = tab === "client" ? "retainer" : "line";
                              return `${n} ${noun}${n !== 1 ? "s" : ""}`;
                            })()}
                          </span>
                        </TableCell>
                        {showFee && (
                          <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface">
                            {group.totalFeeCents > 0 ? formatZar(group.totalFeeCents) : "—"}
                          </TableCell>
                        )}
                        {showPlanned && (
                          <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(group.sold)}
                          </TableCell>
                        )}
                        {showInvoiced && (
                          <TableCell
                            title={billingTitle(billingFor(group.clientId), group.delivered)}
                            className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface"
                          >
                            {invoicedCell(billingFor(group.clientId), group.delivered)}
                          </TableCell>
                        )}
                        {showScheduled && (
                          <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(group.committed)}
                          </TableCell>
                        )}
                        {showBriefed && (
                          <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {fmtHours(group.briefed)}
                          </TableCell>
                        )}
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface">
                          {fmtHours(group.delivered)}
                        </TableCell>
                        <TableCell
                          title={stillDueTitle(showPlanned ? group.sold : group.committed, group.delivered, showPlanned ? "planned" : "scheduled")}
                          className="border-b border-m-outline-variant bg-m-surface-container-low text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant"
                        >
                          {stillDueCell(showPlanned ? group.sold : group.committed, group.delivered)}
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low">
                          {(() => {
                            // Over / under / on track for the client, judged
                            // against the share of the month that has actually
                            // happened — see retainer-status.ts.
                            // Judged against whichever number the tab is
                            // actually showing. Planned left the Recurring tab
                            // with the fee it came from, and an Under badge
                            // measured against a column nobody can see is worse
                            // than no badge — there, the question is simply
                            // whether the standing work got done, so Scheduled
                            // is the basis.
                            const basis = showPlanned ? group.sold : group.committed;
                            const r = retainerStatus({
                              planned: basis,
                              completed: group.delivered,
                              month,
                            });
                            if (r.status === "none") return null;
                            return (
                              <Badge
                                variant={deliveryVariant(r.status)}
                                className="whitespace-nowrap"
                                title={
                                  r.inProgress
                                    ? `${fmtHours(r.expected)} expected by today of ${fmtHours(basis)} ${showPlanned ? "planned" : "scheduled"}`
                                    : `${fmtHours(basis)} ${showPlanned ? "planned" : "scheduled"} for the month`
                                }
                              >
                                {DELIVERY_LABEL[r.status]}
                              </Badge>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="border-b border-m-outline-variant bg-m-surface-container-low" />
                      </TableRow>
                      {openClients[group.clientName] && group.rows.map((r) => (
                        <Fragment key={r.id}>
                          <TableRow
                            onClick={() => navigate(`/projects/${r.id}`)}
                            className="cursor-pointer [&>td]:py-2"
                          >
                            <TableCell className="w-px pr-0">
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`${expanded[r.id] ? "Hide" : "Show"} tasks for ${r.name}`}
                                aria-expanded={!!expanded[r.id]}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpanded(r.id);
                                }}
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 transition-transform",
                                    expanded[r.id] && "rotate-90",
                                  )}
                                />
                              </Button>
                            </TableCell>
                            <TableCell className="text-body-medium text-m-on-surface">
                              {displayRetainerName(r.name, r.client_name)}
                            </TableCell>
                            {showFee && (
                              <TableCell className="text-right text-body-medium font-mono tabular-nums text-m-on-surface">
                                {r.retainer_monthly_fee_cents != null
                                  ? formatZar(r.retainer_monthly_fee_cents)
                                  : "—"}
                              </TableCell>
                            )}
                            {showPlanned && (
                              <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                                {fmtHours(alloc.get(r.id)?.soldHours ?? 0)}
                              </TableCell>
                            )}
                            {showInvoiced && <TableCell className="text-right text-body-medium text-m-on-surface-variant">—</TableCell>}
                            {showScheduled && (
                              <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                                {fmtHours(alloc.get(r.id)?.committedHours ?? 0)}
                              </TableCell>
                            )}
                            {showBriefed && (
                              <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                                {(() => {
                                  const a = alloc.get(r.id);
                                  return fmtHours(a ? briefedHoursOf(a) : 0);
                                })()}
                              </TableCell>
                            )}
                            <TableCell
                              title={completedTitle(alloc.get(r.id))}
                              className="text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface"
                            >
                              {fmtHours(alloc.get(r.id)?.deliveredHours ?? 0)}
                            </TableCell>
                            {(() => {
                              const a = alloc.get(r.id);
                              const basis = (showPlanned ? a?.soldHours : a?.committedHours) ?? 0;
                              const done = a?.deliveredHours ?? 0;
                              return (
                                <TableCell
                                  title={stillDueTitle(basis, done, showPlanned ? "planned" : "scheduled")}
                                  className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant"
                                >
                                  {stillDueCell(basis, done)}
                                </TableCell>
                              );
                            })()}
                            <TableCell>
                              <Badge variant={statusVariant(r.status)} className="whitespace-nowrap">
                                {statusLabel(r.status)}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={sync.isPending}
                                  aria-label={`Sync ${r.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSync(r.id, r.name);
                                  }}
                                >
                                  <RefreshCw
                                    className={cn("h-4 w-4", sync.isPending && sync.variables === r.id && "animate-spin")}
                                  />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={saveTemplate.isPending}
                                  aria-label={`Save ${r.name} as a template`}
                                  title="Save this retainer's services as a reusable template"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveTemplate(r.id, r.name);
                                  }}
                                >
                                  <BookmarkPlus className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={deleteRetainer.isPending}
                                  aria-label={`Delete retainer ${r.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (
                                      confirm(
                                        `Delete "${r.name}" for ${r.client_name}? This removes the retainer and its recurring services. The ClickUp list is left untouched.`,
                                      )
                                    ) {
                                      deleteRetainer.mutate(r.id, {
                                        onSuccess: () => toast.success("Retainer deleted"),
                                        onError: (err) =>
                                          toast.error(`Failed to delete retainer: ${errorMessage(err)}`),
                                      });
                                    }
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {expanded[r.id] && (
                            <TableRow className="hover:bg-transparent">
                              {/* Spans the whole row: it used to be hardcoded
                                  two columns short, which left a white step
                                  down the right of every expanded row — and the
                                  count now varies by tab. */}
                              <TableCell colSpan={columnCount} className="bg-m-surface-container-low p-0">
                                {/* Above the tasks, not inside RetainerSubItems:
                                    that component returns early when a retainer
                                    has no provisioned tasks, and Kings College's
                                    R22,200 marketing retainer has none — the one
                                    place you would most want to reclassify. */}
                                <InternalSwitch retainer={r} />
                                <RetainerSubItems projectId={r.id} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                      {/* Recurring work with no invoice behind it. It keeps its
                          hours — the work is real and someone has to do it —
                          but they are not in the Planned and Scheduled totals
                          above, because no fee bought them. */}
                      {openClients[group.clientName] && group.unbilled.map((r) => (
                        <TableRow
                          key={r.id}
                          onClick={() => navigate(`/projects/${r.id}`)}
                          className="cursor-pointer [&>td]:py-2"
                        >
                          <TableCell className="w-px" />
                          <TableCell className="text-body-medium text-m-on-surface">
                            {displayRetainerName(r.name, r.client_name)}
                            <Badge variant="secondary" className="ml-2 whitespace-nowrap">
                              {r.revenue_source ?? "No fee — source not set"}
                            </Badge>
                          </TableCell>
                          {showFee && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              —
                            </TableCell>
                          )}
                          {showPlanned && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              {fmtHours(alloc.get(r.id)?.soldHours ?? 0)}
                            </TableCell>
                          )}
                          {showInvoiced && <TableCell className="text-right text-body-medium text-m-on-surface-variant">—</TableCell>}
                          {showScheduled && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              {fmtHours(alloc.get(r.id)?.committedHours ?? 0)}
                            </TableCell>
                          )}
                          {showBriefed && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              {(() => {
                                const a = alloc.get(r.id);
                                return fmtHours(a ? briefedHoursOf(a) : 0);
                              })()}
                            </TableCell>
                          )}
                          <TableCell
                            title={completedTitle(alloc.get(r.id))}
                            className="text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface"
                          >
                            {fmtHours(alloc.get(r.id)?.deliveredHours ?? 0)}
                          </TableCell>
                          {(() => {
                            const a = alloc.get(r.id);
                            const basis = (showPlanned ? a?.soldHours : a?.committedHours) ?? 0;
                            const done = a?.deliveredHours ?? 0;
                            return (
                              <TableCell
                                title={stillDueTitle(basis, done, showPlanned ? "planned" : "scheduled")}
                                className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant"
                              >
                                {stillDueCell(basis, done)}
                              </TableCell>
                            );
                          })()}
                          <TableCell>
                            <Badge variant={statusVariant(r.status)} className="whitespace-nowrap">
                              {statusLabel(r.status)}
                            </Badge>
                          </TableCell>
                          <TableCell />
                        </TableRow>
                      ))}
                      {/* The other categories. No Planned or Scheduled: nobody
                          budgeted an hour of ad hoc work in advance, and
                          printing a 0 there would read as a target missed. */}
                      {openClients[group.clientName] && group.extras.map((x) => (
                        <Fragment key={x.key}>
                        <TableRow className="[&>td]:py-2">
                          <TableCell className="w-px pr-0">
                            {/* "Ad hoc — invoiced separately, 8.6h" is a total,
                                not an answer. Lisa, 2026-09-09: "what are the
                                actual adhoc tasks that came in?" The retainer
                                rows have opened to their tasks all along; these
                                had nothing behind them to open. */}
                            {x.items.length > 0 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`${expanded[x.key] ? "Hide" : "Show"} tasks for ${x.name} — ${x.clientName}`}
                                aria-expanded={!!expanded[x.key]}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpanded(x.key);
                                }}
                              >
                                <ChevronRight
                                  className={cn(
                                    "h-4 w-4 transition-transform",
                                    expanded[x.key] && "rotate-90",
                                  )}
                                />
                              </Button>
                            )}
                          </TableCell>
                          <TableCell className="text-body-medium text-m-on-surface">
                            {x.name}
                            <Badge variant="secondary" className="ml-2 whitespace-nowrap">
                              {CATEGORY_LABEL[x.kind]}
                            </Badge>
                          </TableCell>
                          {showFee && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              —
                            </TableCell>
                          )}
                          {showPlanned && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              —
                            </TableCell>
                          )}
                          {showInvoiced && (
                            <TableCell className="text-right text-body-medium text-m-on-surface-variant">—</TableCell>
                          )}
                          {showScheduled && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              —
                            </TableCell>
                          )}
                          {showBriefed && (
                            <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                              {fmtHours(briefedHoursOf(x))}
                            </TableCell>
                          )}
                          <TableCell
                            title={completedTitle(x)}
                            className="text-right font-mono tabular-nums text-body-medium font-semibold text-m-on-surface"
                          >
                            {fmtHours(x.deliveredHours)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-body-medium text-m-on-surface-variant">
                            {/* Nobody planned or scheduled ad hoc work, so there is nothing to be due against. */}
                            —
                          </TableCell>
                          <TableCell className="text-label-small text-m-on-surface-variant">
                            {/* Counts what expanding actually shows. briefCount
                                is closed-only, so on the current month it said
                                "12 briefs" above a list of 24 — the open half is
                                work that came in too. */}
                            {x.items.length > 0
                              ? `${x.items.length} brief${x.items.length !== 1 ? "s" : ""}`
                              : ""}
                          </TableCell>
                          <TableCell />
                        </TableRow>
                        {expanded[x.key] && x.items.length > 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={columnCount} className="bg-m-surface-container-low p-0">
                              <DeliveryItems items={x.items} />
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      ))}
                    </Fragment>
                    ))}
                    </Fragment>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="text-body-medium text-m-on-surface-variant">
            Nothing on this tab for the month you picked.
          </div>
        )}
      </div>
    </div>
  );
}
