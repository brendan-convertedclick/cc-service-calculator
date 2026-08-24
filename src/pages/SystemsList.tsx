// src/pages/SystemsList.tsx
//
// /systems — named, owned, goal-bearing ways of doing something, in three
// layers: policies (the rule), processes (the flow), procedures (the steps).
// Layer is a tab; band demotes to a rail filter. Rail matches the
// SowList/ServicesList standard.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Archive, ArrowRight, Copy, Pencil, Plus, Search, Settings, StickyNote, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MenuItem } from "@/components/ui/menu-item";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, errorMessage } from "@/lib/utils";
import {
  ATTACHMENT_KINDS,
  PLACEHOLDER_GOAL,
  SYSTEM_BANDS,
  SYSTEM_BAND_LABEL,
  SYSTEM_KIND_LABEL,
  SYSTEM_LAYERS,
  SYSTEM_LAYER_BLURB,
  SYSTEM_LAYER_LABEL,
  SYSTEM_LAYER_NOUN,
  systemLayer,
  useCreateSystem,
  useDuplicateSystem,
  useRecurringServiceOptions,
  useSystemDefinitions,
  useUpdateSystem,
  type SystemBand,
  type SystemDefinitionWithJoins,
  type SystemKind,
  type SystemLayer,
} from "@/hooks/useSystemDefinitions";
import { useDepartments } from "@/hooks/useDepartments";
import { useMyOpenNoteCounts } from "@/hooks/useStepNotes";
import { useCurrentUserId } from "@/context/AuthContext";
import { memberColors, useTeam } from "@/hooks/useTeam";
import { useServices } from "@/hooks/useServices";
import { useTimeCategories } from "@/hooks/useOngoingTasks";

const UNBANDED = "unbanded";
const NO_DEPT = "none";

// The team's three states, in the order work moves through them. A revision
// sitting in review wins over an older approved one — the pending decision is
// the thing you'd come to the list to find. Most of the library is Draft, so
// the page opens on Approved and you ask for the rest.
const STATUSES = ["approved", "in_review", "draft", "all"] as const;
type Status = (typeof STATUSES)[number];
const STATUS_LABEL: Record<Status, string> = {
  approved: "Approved",
  in_review: "In review",
  draft: "Draft",
  all: "All",
};
// Same three colours the detail page's REVISION_STATE_BADGE uses, so a row and
// the page it opens don't disagree about what "In review" looks like.
const STATUS_VARIANT: Record<Exclude<Status, "all">, "muted" | "warning" | "success"> = {
  approved: "success",
  in_review: "warning",
  draft: "muted",
};
function statusOf(s: SystemDefinitionWithJoins): Exclude<Status, "all"> {
  if (s.in_review) return "in_review";
  return s.current_revision_id ? "approved" : "draft";
}
function matchesStatus(s: SystemDefinitionWithJoins, status: Status): boolean {
  return status === "all" || statusOf(s) === status;
}

function isBand(b: string | null): b is SystemBand {
  return !!b && (SYSTEM_BANDS as readonly string[]).includes(b);
}

/** Everything the rail search matches. The placeholder goal is excluded — it's
 *  on every unmapped system, so including it makes "todo"/"goal" match half the
 *  page. Use the Health filter for those. */
function haystack(s: SystemDefinitionWithJoins): string {
  return [
    s.name,
    s.goal_statement === PLACEHOLDER_GOAL ? null : s.goal_statement,
    s.owner_name,
    s.service_name,
    s.recurring_service_name,
    s.time_category_label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

/** Turn a create failure into something an operator can act on. 23505 is the
 *  one they'll actually hit — a service already backing a live system. */
function createSystemError(e: unknown, layer: SystemLayer): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code === "23505") {
    return "That service already has a system — open the existing one instead of creating a second.";
  }
  return err?.message || `Could not create ${SYSTEM_LAYER_NOUN[layer]}`;
}

// Rail filters, the layer tab and the scroll position survive opening a system
// and coming back — the list unmounts, so plain state resets. Session-scoped on
// purpose, same as Briefs: a fresh tab starts clean.
const FILTERS_KEY = "systems-filters-v1";
type PersistedFilters = {
  search: string;
  status: Status;
  band: string | null;
  kind: SystemKind | null;
  dept: string | null;
  unmappedOnly: boolean;
  myNotesOnly: boolean;
  tab: SystemLayer;
  scroll: number;
};
function loadFilters(): Partial<PersistedFilters> {
  try {
    return JSON.parse(sessionStorage.getItem(FILTERS_KEY) ?? "{}") as Partial<PersistedFilters>;
  } catch {
    return {};
  }
}

export function SystemsList() {
  const navigate = useNavigate();
  const { data: systems = [], isLoading } = useSystemDefinitions();
  const { data: depts = [] } = useDepartments();
  const { data: team = [] } = useTeam();
  // One palette everywhere a person appears — the canvas, the step rows and
  // this list all read the same colour for the same owner.
  const colorById = useMemo(() => memberColors(team), [team]);
  const duplicate = useDuplicateSystem();
  const update = useUpdateSystem();
  const [search, setSearch] = useState(() => loadFilters().search ?? "");
  const [status, setStatus] = useState<Status>(() => loadFilters().status ?? "approved");
  const [editing, setEditing] = useState<SystemDefinitionWithJoins | null>(null);
  const [band, setBand] = useState<string | null>(() => loadFilters().band ?? null);
  const [kind, setKind] = useState<SystemKind | null>(() => loadFilters().kind ?? null);
  const [dept, setDept] = useState<string | null>(() => loadFilters().dept ?? null);
  const [unmappedOnly, setUnmappedOnly] = useState(() => loadFilters().unmappedOnly ?? false);
  // Notes assigned to whoever is signed in, across the whole library — the
  // way a staff member finds the procedures somebody left work for them on.
  // Null on the shared team@ login (no team_members row), which is why the
  // filter hides itself rather than sitting there reading 0 forever.
  const currentUserId = useCurrentUserId();
  const { data: myNoteCounts } = useMyOpenNoteCounts(currentUserId);
  const [myNotesOnly, setMyNotesOnly] = useState(() => loadFilters().myNotesOnly ?? false);
  // ?new=<name> is how the wizard hands over: open the create dialog with the
  // candidate's name already in it, then drop the param so a refresh doesn't
  // reopen it. The wizard only ever proposes procedures.
  const [params, setParams] = useSearchParams();
  const wizardName = params.get("new");
  const [creating, setCreating] = useState<SystemLayer | null>(wizardName != null ? "procedure" : null);
  // Procedures is where the volume is, and where the wizard hands over.
  const [tab, setTab] = useState<SystemLayer>(() => loadFilters().tab ?? "procedure");

  const mainRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(loadFilters().scroll ?? 0);

  useEffect(() => {
    sessionStorage.setItem(
      FILTERS_KEY,
      JSON.stringify({
        search,
        status,
        band,
        kind,
        dept,
        unmappedOnly,
        myNotesOnly,
        tab,
        scroll: scrollTop.current,
      } satisfies PersistedFilters),
    );
  }, [search, status, band, kind, dept, unmappedOnly, myNotesOnly, tab]);

  // Scroll only lands in storage on the way out — writing it on every scroll
  // event would re-serialise the whole object 60×/s.
  useEffect(
    () => () => {
      sessionStorage.setItem(
        FILTERS_KEY,
        JSON.stringify({ ...loadFilters(), scroll: scrollTop.current }),
      );
    },
    [],
  );

  // Restore it once the rows exist — while the pane is still a "Loading…" line
  // there is nothing to scroll and any scrollTop clamps back to 0.
  const pendingScroll = useRef(scrollTop.current);
  useLayoutEffect(() => {
    if (isLoading || !pendingScroll.current || !mainRef.current) return;
    mainRef.current.scrollTop = pendingScroll.current;
    pendingScroll.current = 0;
  }, [isLoading]);

  const q = search.trim().toLowerCase();

  // Every other rail count is read against the status-scoped set, so "All
  // areas · 121" can't sit next to a one-row list.
  const scoped = useMemo(() => systems.filter((s) => matchesStatus(s, status)), [systems, status]);

  const filtered = useMemo(
    () =>
      scoped.filter((s) => {
        if (band && (isBand(s.band) ? s.band : UNBANDED) !== band) return false;
        if (kind && s.kind !== kind) return false;
        // A system sits in every department its steps do, so a cross-team
        // procedure shows under each of them rather than one arbitrary owner.
        if (dept && !(dept === NO_DEPT ? s.department_ids.length === 0 : s.department_ids.includes(dept)))
          return false;
        if (unmappedOnly && s.goal_statement !== PLACEHOLDER_GOAL) return false;
        if (myNotesOnly && !myNoteCounts?.has(s.id)) return false;
        if (q && !haystack(s).includes(q)) return false;
        return true;
      }),
    [scoped, band, kind, dept, unmappedOnly, myNotesOnly, myNoteCounts, q],
  );

  // All three tabs always render, empty or not — the taxonomy is the point of
  // this page, and a missing "Policies" tab reads as "we don't do those" rather
  // than "none written yet".
  const grouped = useMemo(() => {
    const byLayer = new Map<SystemLayer, SystemDefinitionWithJoins[]>();
    for (const s of filtered) {
      const key = systemLayer(s.kind);
      const arr = byLayer.get(key) ?? [];
      arr.push(s);
      byLayer.set(key, arr);
    }
    return SYSTEM_LAYERS.map((l) => ({ layer: l, items: byLayer.get(l) ?? [] }));
  }, [filtered]);

  const bandCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of scoped) {
      const key = isBand(s.band) ? s.band : UNBANDED;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [scoped]);

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<SystemKind, number>> = {};
    for (const s of scoped) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    return counts;
  }, [scoped]);

  const deptCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of scoped) {
      if (s.department_ids.length === 0) counts[NO_DEPT] = (counts[NO_DEPT] ?? 0) + 1;
      for (const d of s.department_ids) counts[d] = (counts[d] ?? 0) + 1;
    }
    return counts;
  }, [scoped]);

  const statusCounts = useMemo(() => {
    const counts: Record<Status, number> = { approved: 0, in_review: 0, draft: 0, all: systems.length };
    for (const s of systems) counts[statusOf(s)] += 1;
    return counts;
  }, [systems]);

  const anyFilterActive = !!q || band !== null || kind !== null || dept !== null || unmappedOnly || myNotesOnly;

  const unmappedCount = useMemo(
    () => scoped.filter((s) => s.goal_statement === PLACEHOLDER_GOAL).length,
    [scoped],
  );

  // Archive, not delete — a system that has run carries revisions, steps and
  // ClickUp history behind it. It drops out of every list (the query filters
  // archived_at) and there is no un-archive surface yet, so confirm first.
  const archive = (s: SystemDefinitionWithJoins) => {
    if (!window.confirm(`Archive "${s.name}"? It disappears from the library — there's no undo screen yet.`)) return;
    update.mutate(
      { id: s.id, patch: { archived_at: new Date().toISOString() } },
      {
        onSuccess: () => toast.success(`${s.name} archived`),
        onError: (e) => toast.error(`Could not archive: ${errorMessage(e)}`),
      },
    );
  };

  return (
    <div className="flex h-full">
      {/* ── Left filter rail ─────────────────────────────────────────────── */}
      <aside className="w-56 shrink-0 space-y-5 overflow-y-auto border-r border-m-outline-variant p-4">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-m-on-surface-variant" />
          <Input
            aria-label="Search systems"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-8"
          />
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Status</p>
          <ul className="space-y-0.5">
            {STATUSES.map((st) => (
              <FilterRow
                key={st}
                label={STATUS_LABEL[st]}
                active={status === st}
                onClick={() => setStatus(st)}
                count={statusCounts[st]}
              />
            ))}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Area</p>
          <ul className="space-y-0.5">
            <FilterRow label="All areas" active={band === null} onClick={() => setBand(null)} count={scoped.length} />
            {[...SYSTEM_BANDS, UNBANDED].map((b) =>
              bandCounts[b] ? (
                <FilterRow
                  key={b}
                  label={b === UNBANDED ? "No area" : SYSTEM_BAND_LABEL[b as SystemBand]}
                  active={band === b}
                  onClick={() => setBand(b)}
                  count={bandCounts[b]}
                />
              ) : null,
            )}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Attached to</p>
          <ul className="space-y-0.5">
            <FilterRow label="Anything" active={kind === null} onClick={() => setKind(null)} count={scoped.length} />
            {ATTACHMENT_KINDS.map((k) =>
              kindCounts[k] ? (
                <FilterRow key={k} label={SYSTEM_KIND_LABEL[k]} active={kind === k} onClick={() => setKind(k)} count={kindCounts[k]} />
              ) : null,
            )}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Department</p>
          <ul className="space-y-0.5">
            <FilterRow label="All departments" active={dept === null} onClick={() => setDept(null)} count={scoped.length} />
            {depts.map((d) =>
              deptCounts[d.id] ? (
                <FilterRow key={d.id} label={d.name} active={dept === d.id} onClick={() => setDept(d.id)} count={deptCounts[d.id]} />
              ) : null,
            )}
            {deptCounts[NO_DEPT] ? (
              <FilterRow
                label="No department"
                active={dept === NO_DEPT}
                onClick={() => setDept(NO_DEPT)}
                count={deptCounts[NO_DEPT]}
              />
            ) : null}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Health</p>
          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-label-medium text-m-on-surface hover:bg-m-surface-container">
            <Checkbox checked={unmappedOnly} onCheckedChange={(v) => setUnmappedOnly(!!v)} />
            Unmapped / no goal
            <span className="ml-auto tabular-nums text-label-small text-m-on-surface-variant">{unmappedCount}</span>
          </label>
        </div>
        {currentUserId && (
          <div>
            <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Notes</p>
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-label-medium text-m-on-surface hover:bg-m-surface-container">
              <Checkbox checked={myNotesOnly} onCheckedChange={(v) => setMyNotesOnly(!!v)} />
              Assigned to me
              <span className="ml-auto tabular-nums text-label-small text-m-on-surface-variant">
                {scoped.filter((s) => myNoteCounts?.has(s.id)).length}
              </span>
            </label>
          </div>
        )}
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div
        ref={mainRef}
        onScroll={(e) => {
          scrollTop.current = e.currentTarget.scrollTop;
        }}
        className="min-w-0 flex-1 overflow-y-auto p-6"
      >
        <div className="mb-6">
          <h1 className="text-headline-medium">Systems</h1>
          <p className="mt-1 text-body-medium text-m-on-surface-variant">
            How the agency runs, in three layers — the rules, the flows between people, and the
            steps one person follows.
          </p>
        </div>

        {isLoading ? (
          <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as SystemLayer)}>
            <div className="flex items-center justify-between gap-3">
              <TabsList>
                {grouped.map((g) => (
                  <TabsTrigger key={g.layer} value={g.layer}>
                    {SYSTEM_LAYER_LABEL[g.layer]} · {g.items.length}
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="flex flex-none items-center gap-2">
                {/* The triage that runs before a procedure exists — the answer
                    is often "don't build one". Lives here rather than in the
                    nav: it's only ever reached on the way to a procedure. */}
                {tab === "procedure" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/procedure-wizard")}
                    className="gap-1"
                  >
                    <Wand2 className="h-4 w-4" /> Wizard
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setCreating(tab)} className="gap-1">
                  <Plus className="h-4 w-4" /> New {SYSTEM_LAYER_NOUN[tab]}
                </Button>
              </div>
            </div>

            {grouped.map((g) => (
              <TabsContent key={g.layer} value={g.layer} className="mt-4">
                <p className="mb-2 text-label-medium text-m-on-surface-variant">
                  {SYSTEM_LAYER_BLURB[g.layer]}
                </p>
                <Card className="overflow-hidden border-m-outline-variant">
                  <CardContent className="p-0">
                    {g.items.length === 0 ? (
                      <p className="px-4 py-6 text-center text-body-small text-m-on-surface-variant">
                        {status === "approved" && !anyFilterActive ? (
                          <>
                            No {SYSTEM_LAYER_LABEL[g.layer].toLowerCase()} approved yet — a system
                            is approved once a revision is signed off.{" "}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={() => setStatus("all")}
                            >
                              Show all {statusCounts.all}
                            </button>
                          </>
                        ) : anyFilterActive || status !== "all"
                          ? `No ${SYSTEM_LAYER_LABEL[g.layer].toLowerCase()} match your filters.`
                          : `No ${SYSTEM_LAYER_LABEL[g.layer].toLowerCase()} written up yet.`}
                      </p>
                    ) : (
                      <ul className="divide-y divide-m-outline-variant">
                        {g.items.map((s) => (
                          <SystemRow
                            key={s.id}
                            system={s}
                            onClick={() => navigate(`/systems/${s.id}`)}
                            onEdit={() => setEditing(s)}
                            onArchive={() => archive(s)}
                            busy={duplicate.isPending || update.isPending}
                            ownerColor={s.owner_id ? colorById.get(s.owner_id) : undefined}
                            myNotes={myNoteCounts?.get(s.id)}
                            onDuplicate={() =>
                              duplicate.mutate(s.id, {
                                onSuccess: (newId) => {
                                  // A service-kind copy can't hang off the same
                                  // service (0107), so the RPC lands it as a
                                  // reference — say so rather than let the
                                  // badge silently disagree with the original.
                                  toast.success(
                                    s.kind === "service"
                                      ? "Copied as a Reference procedure — a service can only back one."
                                      : `${SYSTEM_LAYER_LABEL[systemLayer(s.kind)].slice(0, -1)} duplicated`,
                                  );
                                  navigate(`/systems/${newId}`);
                                },
                                onError: (e) => toast.error(`Could not duplicate: ${errorMessage(e)}`),
                              })
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      <EditSystemDialog
        system={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) =>
          editing &&
          update.mutate(
            { id: editing.id, patch },
            {
              onSuccess: () => {
                toast.success("Saved");
                setEditing(null);
              },
              onError: (e) => toast.error(`Could not save: ${errorMessage(e)}`),
            },
          )
        }
      />

      <NewSystemDialog
        layer={creating}
        initialName={wizardName ?? ""}
        onClose={() => {
          setCreating(null);
          if (wizardName != null) setParams({}, { replace: true });
        }}
        onCreated={(id) => navigate(`/systems/${id}`)}
      />
    </div>
  );
}

function SystemRow({
  system,
  onClick,
  onDuplicate,
  onEdit,
  onArchive,
  busy,
  ownerColor,
  myNotes,
}: {
  system: SystemDefinitionWithJoins;
  onClick: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onArchive: () => void;
  busy: boolean;
  ownerColor: string | undefined;
  /** Open notes on this system assigned to whoever is signed in. */
  myNotes: number | undefined;
}) {
  const isUnmapped = system.goal_statement === PLACEHOLDER_GOAL;
  const layer = systemLayer(system.kind);
  const rowStatus = statusOf(system);
  const linkLabel =
    system.kind === "service"
      ? system.service_name
      : system.kind === "recurring"
        ? system.recurring_service_name
        : system.kind === "internal"
          ? system.time_category_label
          : null;
  // A policy or process hangs off nothing, so the attachment line would always
  // read "—". Show what it's *for* instead.
  const subLine = linkLabel ?? (isUnmapped ? null : system.goal_statement);

  return (
    // The row's body is a button, so the actions menu has to be its sibling,
    // not a nested button — hover and padding move up to the <li>.
    <li className="flex items-center gap-1 pr-2 hover:bg-m-surface-container">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-title-small text-m-on-surface">{system.name}</span>
            {layer === "procedure" && (
              <Badge variant="outline" className="flex-none text-label-small">{SYSTEM_KIND_LABEL[system.kind]}</Badge>
            )}
            {/* Where the procedure stands, in the team's vocabulary. Replaces
                the old "Active" tag — Approved says the same thing, and a row
                in review needs to say so even when an older revision is live. */}
            <Badge variant={STATUS_VARIANT[rowStatus]} className="flex-none text-label-small">
              {STATUS_LABEL[rowStatus]}
            </Badge>
            {isUnmapped && (
              <Badge variant="warning" className="flex-none gap-1 text-label-small">
                <AlertTriangle className="h-3 w-3" /> No goal
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-label-small text-m-on-surface-variant">
            {subLine ?? "—"}
          </p>
        </div>
        {/* Work somebody left for you on this procedure. Silent at zero — a
            "0" on every row is noise, and the whole point is that a row with
            something waiting stands out. */}
        {myNotes ? (
          <span
            title={`${myNotes} open note${myNotes === 1 ? "" : "s"} assigned to you`}
            className="flex flex-none items-center gap-1 rounded-full bg-m-primary-container px-2 py-0.5 text-label-small text-m-on-primary-container"
          >
            <StickyNote className="h-3 w-3" />
            {myNotes}
          </span>
        ) : null}
        {/* A policy is prose, not steps — a "0 steps" tag on one reads as a gap. */}
        {layer !== "policy" && (
          <span className="flex-none text-label-small text-m-on-surface-variant">
            {system.step_count} step{system.step_count === 1 ? "" : "s"}
          </span>
        )}
        {system.owner_name ? (
          <span
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-label-small font-semibold text-white"
            style={{ background: ownerColor }}
            title={system.owner_name}
          >
            {initials(system.owner_name)}
          </span>
        ) : (
          <span
            className="h-6 w-6 flex-none rounded-full border border-dashed border-m-outline"
            title="No owner assigned"
          />
        )}
      </button>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Actions for "${system.name}"`}
            className="flex-none rounded-md p-2 text-m-on-surface-variant hover:bg-m-surface-container-high hover:text-m-on-surface"
          >
            <Settings className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-52 p-1">
          <MenuItem icon={ArrowRight} label="Open" onClick={onClick} />
          <MenuItem icon={Pencil} label="Rename / area" onClick={onEdit} />
          <MenuItem icon={Copy} label="Duplicate" disabled={busy} onClick={onDuplicate} />
          <MenuItem icon={Archive} label="Archive" destructive disabled={busy} onClick={onArchive} />
        </PopoverContent>
      </Popover>
    </li>
  );
}

// Name and area, the two things the list itself shows and sorts on. Everything
// else about a system is edited on its own page — this is the quick fix you
// make without leaving the library.
function EditSystemDialog({
  system,
  onClose,
  onSave,
}: {
  system: SystemDefinitionWithJoins | null;
  onClose: () => void;
  onSave: (patch: { name: string; band: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [band, setBand] = useState("");

  // Re-seed each time a different row opens the dialog.
  useEffect(() => {
    if (system) {
      setName(system.name);
      setBand(system.band ?? "");
    }
  }, [system]);

  const trimmed = name.trim();

  return (
    <Dialog open={!!system} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {system ? SYSTEM_LAYER_NOUN[systemLayer(system.kind)] : "system"}</DialogTitle>
          <DialogDescription>Name and area. The rest lives on its own page.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-system-name">Name</Label>
            <Input
              id="edit-system-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && trimmed) onSave({ name: trimmed, band: band || null });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-system-band">Area</Label>
            <select
              id="edit-system-band"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              className="h-10 w-full rounded-md border border-m-outline-variant bg-transparent px-3 text-body-medium"
            >
              <option value="">No area</option>
              {SYSTEM_BANDS.map((b) => (
                <option key={b} value={b}>
                  {SYSTEM_BAND_LABEL[b]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!trimmed} onClick={() => onSave({ name: trimmed, band: band || null })}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewSystemDialog({
  layer,
  initialName,
  onClose,
  onCreated,
}: {
  /** null = closed. The section's button decides which layer you're adding. */
  layer: SystemLayer | null;
  initialName: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createSystem = useCreateSystem();
  const { data: services = [] } = useServices();
  const { data: timeCategories = [] } = useTimeCategories();
  const { data: recurringOptions = [] } = useRecurringServiceOptions();

  // A service backs exactly one live system — system_definitions_one_per_service_idx
  // (0107), kept because push-to-clickup resolves service -> system when it
  // materialises a quote line. Time categories and recurring services take as
  // many as you like (0119): "Client Meetings" is a pre-, in- and post-meeting
  // procedure. Taken services stay visible but disabled: silently omitting them
  // just raises "where did my service go?", and picking one is a 23505 on submit.
  const { data: existing = [] } = useSystemDefinitions();
  const takenServices = useMemo(
    () => new Set(existing.filter((s) => !s.archived_at && s.service_id).map((s) => s.service_id!)),
    [existing],
  );


  const [name, setName] = useState(initialName);
  // Only a procedure gets to choose an attachment; a policy or a process IS
  // its kind.
  const [attachment, setAttachment] = useState<SystemKind>("service");
  const kind: SystemKind = layer && layer !== "procedure" ? layer : attachment;
  const noun = SYSTEM_LAYER_NOUN[layer ?? "procedure"];
  const [goal, setGoal] = useState("");
  const [band, setBand] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [recurringId, setRecurringId] = useState("");
  const [timeCategoryId, setTimeCategoryId] = useState("");

  function reset() {
    setName("");
    setAttachment("service");
    setGoal("");
    setBand("");
    setServiceId("");
    setRecurringId("");
    setTimeCategoryId("");
  }

  function closeAndReset() {
    reset();
    onClose();
  }

  function submit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!goal.trim()) {
      toast.error(`Goal is required — a ${noun} can't be created without one`);
      return;
    }
    if (kind === "service" && !serviceId) {
      toast.error("Pick the service this procedure belongs to");
      return;
    }
    if (kind === "recurring" && !recurringId) {
      toast.error("Pick the recurring service this procedure belongs to");
      return;
    }
    if (kind === "internal" && !timeCategoryId) {
      toast.error("Pick the time category this procedure attributes to");
      return;
    }

    createSystem.mutate(
      {
        name: name.trim(),
        kind,
        goal_statement: goal.trim(),
        band: band || null,
        service_id: kind === "service" ? serviceId : null,
        recurring_service_id: kind === "recurring" ? recurringId : null,
        time_category_id: kind === "internal" ? timeCategoryId : null,
      },
      {
        onSuccess: (s) => {
          toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} created`);
          reset();
          onCreated(s.id);
        },
        // supabase-js rejects with a PostgrestError, which is a plain object —
        // `instanceof Error` is false for it, so the real reason was being
        // swallowed and every failure read "Could not create procedure".
        onError: (e) => toast.error(createSystemError(e, layer ?? "procedure")),
      },
    );
  }

  return (
    <Dialog open={layer !== null} onOpenChange={(o) => !o && closeAndReset()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New {noun}</DialogTitle>
          <DialogDescription>{SYSTEM_LAYER_BLURB[layer ?? "procedure"]}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sys-name">Name</Label>
            <Input id="sys-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={
                layer === "policy" ? "e.g. Client refund policy"
                : layer === "process" ? "e.g. Lead to live campaign"
                : "e.g. Outbound sales"
              } />
          </div>

          {layer === "procedure" && (
            <div className="space-y-1">
              <Label htmlFor="sys-kind">Attached to</Label>
              <select
                id="sys-kind"
                value={attachment}
                onChange={(e) => setAttachment(e.target.value as SystemKind)}
                className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-3 text-body-medium text-m-on-surface"
              >
                {ATTACHMENT_KINDS.map((k) => (
                  <option key={k} value={k}>{SYSTEM_KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
          )}

          {kind === "service" && (
            <div className="space-y-1">
              <Label htmlFor="sys-service">Service</Label>
              <select
                id="sys-service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-3 text-body-medium text-m-on-surface"
              >
                <option value="">— select a service</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id} disabled={takenServices.has(s.id)}>
                    {s.name}{takenServices.has(s.id) ? " — already has a procedure" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === "recurring" && (
            <div className="space-y-1">
              <Label htmlFor="sys-recurring">Recurring service</Label>
              <select
                id="sys-recurring"
                value={recurringId}
                onChange={(e) => setRecurringId(e.target.value)}
                className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-3 text-body-medium text-m-on-surface"
              >
                <option value="">— select a recurring service</option>
                {recurringOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {kind === "internal" && (
            <div className="space-y-1">
              <Label htmlFor="sys-category">Time category</Label>
              <select
                id="sys-category"
                value={timeCategoryId}
                onChange={(e) => setTimeCategoryId(e.target.value)}
                className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-3 text-body-medium text-m-on-surface"
              >
                <option value="">— select a time category</option>
                {timeCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="sys-band">Area</Label>
            <select
              id="sys-band"
              value={band}
              onChange={(e) => setBand(e.target.value)}
              className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-3 text-body-medium text-m-on-surface"
            >
              <option value="">— none</option>
              {SYSTEM_BANDS.map((b) => (
                <option key={b} value={b}>{SYSTEM_BAND_LABEL[b]}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sys-goal">Goal statement</Label>
            <Textarea
              id="sys-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder={`What does this ${noun} exist to achieve?`}
            />
            <p className="text-label-small text-m-on-surface-variant">
              Required — a system can't be created without a goal.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeAndReset}>Cancel</Button>
          <Button onClick={submit} disabled={createSystem.isPending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Single-select filter row for the rail. Matches SowList/ServicesList. */
function FilterRow({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-body-small",
          active
            ? "bg-m-secondary-container text-m-on-secondary-container"
            : "text-m-on-surface hover:bg-m-surface-container",
        )}
      >
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="ml-2 tabular-nums text-label-small opacity-70">{count}</span>}
      </button>
    </li>
  );
}
