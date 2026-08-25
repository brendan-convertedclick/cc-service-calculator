import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, Link2Off } from "lucide-react";
import { ClientReview } from "@/pages/ClientReview";
import { FilterGroup, FilterOption } from "@/components/filters/FilterRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  daysWaiting,
  useClientSignoffs,
  useLiveLinkCounts,
  type SignoffRow,
} from "@/hooks/useClientSignoffs";
import { errorMessage } from "@/lib/utils";

const STATE_LABEL: Record<string, string> = {
  pending: "Waiting on client",
  approved: "Approved",
  changes_requested: "Changes requested",
};

function StateBadge({ state }: { state: string }) {
  if (state === "approved") {
    return (
      <Badge className="bg-m-tertiary-container text-m-on-tertiary-container">Approved</Badge>
    );
  }
  if (state === "changes_requested") {
    return <Badge variant="outline">Changes requested</Badge>;
  }
  return (
    <Badge className="bg-m-primary-container text-m-on-primary-container">Waiting on client</Badge>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-ZA");
}

export function ClientSignoffs() {
  const { data: rows = [], isPending, isError, error } = useClientSignoffs();
  const { data: linkCounts = {} } = useLiveLinkCounts();
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);

  // One entry per client that has ever been asked to sign something off.
  const clients = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; waiting: number }>();
    for (const r of rows) {
      const entry = byId.get(r.client_id) ?? { id: r.client_id, name: r.client_name, waiting: 0 };
      if (r.state === "pending") entry.waiting += 1;
      byId.set(r.client_id, entry);
    }
    return [...byId.values()].sort(
      (a, b) => b.waiting - a.waiting || a.name.localeCompare(b.name),
    );
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (clientId ? r.client_id === clientId : true))
      .filter(
        (r) =>
          !q ||
          r.client_title.toLowerCase().includes(q) ||
          r.client_name.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        // Longest-waiting first — the whole point of the page.
        const aw = daysWaiting(a);
        const bw = daysWaiting(b);
        if (aw !== bw) return bw - aw;
        if (a.state !== b.state) return a.state === "pending" ? -1 : 1;
        return b.created_at.localeCompare(a.created_at);
      });
  }, [rows, clientId, search]);

  const waiting = rows.filter((r) => r.state === "pending");
  const worst = waiting.reduce((m, r) => Math.max(m, daysWaiting(r)), 0);
  const selected = clients.find((c) => c.id === clientId) ?? null;
  const selectedHasLink = selected ? (linkCounts[selected.id] ?? 0) > 0 : true;

  return (
    <div className="flex h-full">
      <aside className="w-64 shrink-0 border-r border-m-outline-variant">
        <div className="p-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sign-offs…"
            aria-label="Search sign-offs"
          />
        </div>
        <div className="space-y-4 border-t border-m-outline-variant p-3">
          <FilterGroup label="Client">
            <FilterOption
              label="All clients"
              count={waiting.length}
              active={clientId === null}
              onToggle={() => setClientId(null)}
            />
            {clients.map((c) => (
              <FilterOption
                key={c.id}
                label={c.name}
                count={c.waiting}
                active={clientId === c.id}
                onToggle={() => setClientId(clientId === c.id ? null : c.id)}
              />
            ))}
          </FilterGroup>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="border-b border-m-outline-variant px-6 py-4">
          <h1 className="text-headline-small text-m-on-surface">Client sign-offs</h1>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            {waiting.length === 0
              ? "Nothing is waiting on a client right now."
              : `${waiting.length} ${waiting.length === 1 ? "item is" : "items are"} waiting on a client${
                  worst > 0 ? ` — the oldest is ${worst} days past its date` : ""
                }.`}
          </p>
        </div>

        {isError ? (
          <p className="p-6 text-body-medium text-m-error">
            Could not load sign-offs: {errorMessage(error)}
          </p>
        ) : isPending ? (
          <div className="flex flex-col gap-2 p-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 rounded-md" />
            ))}
          </div>
        ) : (
          <>
            {selected ? (
              <div className="border-b border-m-outline-variant p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-title-medium text-m-on-surface">
                      What {selected.name} sees
                    </h2>
                    <p className="mt-0.5 text-body-small text-m-on-surface-variant">
                      The live page, rendered exactly as they get it. Pressing a button here
                      records nothing.
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/clients/${selected.id}`}>
                      Manage their link <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>

                {!selectedHasLink && (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-m-outline-variant bg-m-surface-container p-3">
                    <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-m-on-surface-variant" />
                    <p className="text-body-small text-m-on-surface-variant">
                      {selected.name} has no live link, so they cannot reach this page yet.
                      Create one on their client page.
                    </p>
                  </div>
                )}

                {/* The client's own screen. Framed and scaled down so it reads as a
                    preview rather than the real thing, but rendered by the same
                    component the client gets — never a staff-only lookalike. */}
                <div className="overflow-hidden rounded-xl border border-m-outline-variant bg-m-background shadow-elev-1">
                  <div className="h-[720px] overflow-hidden">
                    <ClientReview previewClientId={selected.id} />
                  </div>
                </div>
              </div>
            ) : null}

            {selected && visible.length > 0 ? (
              <h2 className="px-6 pb-2 pt-5 text-title-small text-m-on-surface">
                {selected.name}&apos;s items, with our own columns
              </h2>
            ) : null}

            {visible.length === 0 ? (
              <p className="p-6 text-body-medium text-m-on-surface-variant">
                No sign-offs yet. Send one from a brief&apos;s scope page.
              </p>
            ) : (
              <table className="w-full text-body-medium">
                <thead>
                  <tr className="border-b border-m-outline-variant text-label-medium text-m-on-surface-variant">
                    <th className="px-6 py-2 text-left font-medium">Client</th>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-left font-medium">State</th>
                    <th className="px-3 py-2 text-right font-medium">Waiting</th>
                    <th className="px-6 py-2 text-left font-medium">Decided by</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r: SignoffRow) => {
                    const late = daysWaiting(r);
                    return (
                      <tr key={r.id} className="border-b border-m-outline-variant/60">
                        <td className="px-6 py-2.5">
                          <button
                            type="button"
                            onClick={() => setClientId(r.client_id)}
                            className="text-left text-m-primary hover:underline"
                          >
                            {r.client_name}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-m-on-surface">{r.client_title}</td>
                        <td className="px-3 py-2.5">
                          <StateBadge state={STATE_LABEL[r.state] ? r.state : "pending"} />
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {r.state !== "pending" ? (
                            <span className="text-m-on-surface-variant">—</span>
                          ) : late > 0 ? (
                            <span className="inline-flex items-center gap-1 text-m-error">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              {late}d
                            </span>
                          ) : (
                            <span className="text-m-on-surface-variant">on time</span>
                          )}
                        </td>
                        <td className="px-6 py-2.5 text-m-on-surface-variant">
                          {r.decided_by_name
                            ? `${r.decided_by_name} · ${fmtDate(r.decided_at)}`
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
