// src/pages/Feedback.tsx
//
// Bug and feedback triage (/feedback, admin/owner). Every report is either
// resolved or discarded with a reason — the reason is enforced by a check
// constraint in migration 0123, not just by this form, because "discarded, no
// note" is the state that makes the queue useless a month later.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bug, CheckCircle2, MessageSquarePlus, Search, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { signScreenshot } from "@/lib/feedback";
import { errorMessage } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";

interface FeedbackReport {
  id: string;
  kind: "bug" | "feedback";
  summary: string;
  details: string;
  page_path: string | null;
  user_agent: string | null;
  screenshot_paths: string[];
  status: "open" | "resolved" | "discarded";
  resolution_note: string | null;
  resolved_at: string | null;
  created_by_email: string | null;
  created_at: string;
}

const STATUSES = ["open", "resolved", "discarded"] as const;
const KINDS = ["bug", "feedback"] as const;

const STATUS_TONE: Record<string, string> = {
  open: "bg-m-surface-container text-m-on-surface-variant",
  resolved: "bg-m-primary-container text-m-on-primary-container",
  discarded: "bg-m-surface-container-high text-m-on-surface-variant",
};

/** Signed URLs, because the bucket is private and they expire. */
function Screenshots({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    if (paths.length === 0) return;
    let cancelled = false;
    (async () => {
      const signed = await Promise.all(paths.map(signScreenshot));
      if (!cancelled) setUrls(signed.filter((u): u is string => !!u));
    })();
    return () => {
      cancelled = true;
    };
  }, [paths]);

  if (paths.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={`Screenshot ${i + 1}`}
            className="max-h-40 rounded-md border border-m-outline-variant"
          />
        </a>
      ))}
    </div>
  );
}

function ReportCard({
  report,
  onTriage,
}: {
  report: FeedbackReport;
  onTriage: (id: string, status: "resolved" | "discarded", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const Icon = report.kind === "bug" ? Bug : MessageSquarePlus;

  async function triage(status: "resolved" | "discarded") {
    setBusy(true);
    await onTriage(report.id, status, note.trim());
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-lg border border-m-outline-variant bg-m-surface p-4">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-m-on-surface-variant" />
        <div className="min-w-0 flex-1">
          <p className="text-title-small text-m-on-surface">{report.summary}</p>
          <p className="text-label-small text-m-on-surface-variant">
            {report.created_by_email ?? "Unknown"} · {new Date(report.created_at).toLocaleString()}
            {report.page_path && ` · ${report.page_path}`}
          </p>
        </div>
        <Badge className={STATUS_TONE[report.status]}>{report.status}</Badge>
      </div>

      {report.details && (
        <p className="whitespace-pre-wrap text-body-medium text-m-on-surface-variant">
          {report.details}
        </p>
      )}

      <Screenshots paths={report.screenshot_paths} />

      {report.user_agent && (
        <p className="truncate text-label-small text-m-on-surface-variant" title={report.user_agent}>
          {report.user_agent}
        </p>
      )}

      {report.status === "open" ? (
        discarding ? (
          <div className="space-y-2">
            <Textarea
              rows={2}
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this being discarded? (required)"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={!note.trim() || busy}
                onClick={() => triage("discarded")}
              >
                Discard
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDiscarding(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => triage("resolved")}>
              <CheckCircle2 className="h-4 w-4" />
              Resolve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setDiscarding(true)}>
              <XCircle className="h-4 w-4" />
              Discard
            </Button>
          </div>
        )
      ) : (
        report.resolution_note && (
          <p className="rounded-md bg-m-surface-container px-3 py-2 text-body-small text-m-on-surface-variant">
            {report.resolution_note}
          </p>
        )
      )}
    </div>
  );
}

export function Feedback() {
  const [rows, setRows] = useState<FeedbackReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>("open");
  const [kind, setKind] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("feedback_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(errorMessage(error));
      return;
    }
    setLoadError(null);
    setRows((data ?? []) as FeedbackReport[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const triage = useCallback(
    async (id: string, next: "resolved" | "discarded", note: string) => {
      const { error } = await supabase
        .from("feedback_reports")
        .update({
          status: next,
          resolution_note: note || null,
          resolved_at: new Date().toISOString(),
          resolved_by: (await supabase.auth.getUser()).data.user?.id ?? null,
        })
        .eq("id", id);
      if (error) {
        toast.error(`Could not update: ${errorMessage(error)}`);
        return;
      }
      toast.success(next === "resolved" ? "Marked resolved" : "Discarded");
      await load();
    },
    [load],
  );

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (r) =>
          (!status || r.status === status) &&
          (!kind || r.kind === kind) &&
          (!q ||
            r.summary.toLowerCase().includes(q) ||
            r.details.toLowerCase().includes(q) ||
            (r.created_by_email ?? "").toLowerCase().includes(q)),
      ),
    [rows, status, kind, q],
  );

  const countBy = (pick: (r: FeedbackReport) => string, value: string) =>
    (rows ?? []).filter((r) => pick(r) === value).length;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="w-56 shrink-0 space-y-4 border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            className="pl-8"
            placeholder="Search reports"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterGroup label="Status">
          {STATUSES.map((s) => (
            <FilterOption
              key={s}
              label={s}
              count={countBy((r) => r.status, s)}
              active={status === s}
              onToggle={() => setStatus(status === s ? null : s)}
            />
          ))}
        </FilterGroup>
        <FilterGroup label="Type">
          {KINDS.map((k) => (
            <FilterOption
              key={k}
              label={k}
              count={countBy((r) => r.kind, k)}
              active={kind === k}
              onToggle={() => setKind(kind === k ? null : k)}
            />
          ))}
        </FilterGroup>
      </aside>

      <div className="min-w-0 flex-1 space-y-4 overflow-auto p-6">
        <h1 className="text-headline-small text-m-on-surface">Feedback</h1>

        {loadError && <p className="text-body-medium text-destructive">{loadError}</p>}

        {rows === null ? (
          <Skeleton className="h-32 w-full" />
        ) : filtered.length === 0 ? (
          <p className="text-body-medium text-m-on-surface-variant">
            Nothing here — no reports match these filters.
          </p>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <ReportCard key={r.id} report={r} onTriage={triage} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
