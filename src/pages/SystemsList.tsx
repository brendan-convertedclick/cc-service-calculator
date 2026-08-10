// src/pages/SystemsList.tsx
//
// /systems — named, owned, goal-bearing ways of doing something, in three
// layers: policies (the rule), processes (the flow), procedures (the steps).
// Layer is a tab; band demotes to a rail filter. Rail matches the
// SowList/ServicesList standard.

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Plus, Search, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
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
  useRecurringServiceOptions,
  useSystemDefinitions,
  type SystemBand,
  type SystemDefinitionWithJoins,
  type SystemKind,
  type SystemLayer,
} from "@/hooks/useSystemDefinitions";
import { useServices } from "@/hooks/useServices";
import { useTimeCategories } from "@/hooks/useOngoingTasks";

const UNBANDED = "unbanded";

function isBand(b: string | null): b is SystemBand {
  return !!b && (SYSTEM_BANDS as readonly string[]).includes(b);
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

export function SystemsList() {
  const navigate = useNavigate();
  const { data: systems = [], isLoading } = useSystemDefinitions();
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<string | null>(null);
  const [kind, setKind] = useState<SystemKind | null>(null);
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  // ?new=<name> is how the wizard hands over: open the create dialog with the
  // candidate's name already in it, then drop the param so a refresh doesn't
  // reopen it. The wizard only ever proposes procedures.
  const [params, setParams] = useSearchParams();
  const wizardName = params.get("new");
  const [creating, setCreating] = useState<SystemLayer | null>(wizardName != null ? "procedure" : null);
  // Procedures is where the volume is, and where the wizard hands over.
  const [tab, setTab] = useState<SystemLayer>("procedure");

  const q = search.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      systems.filter((s) => {
        if (band && (isBand(s.band) ? s.band : UNBANDED) !== band) return false;
        if (kind && s.kind !== kind) return false;
        if (unmappedOnly && s.goal_statement !== PLACEHOLDER_GOAL) return false;
        if (q && !s.name.toLowerCase().includes(q)) return false;
        return true;
      }),
    [systems, band, kind, unmappedOnly, q],
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
    for (const s of systems) {
      const key = isBand(s.band) ? s.band : UNBANDED;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [systems]);

  const kindCounts = useMemo(() => {
    const counts: Partial<Record<SystemKind, number>> = {};
    for (const s of systems) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    return counts;
  }, [systems]);

  const anyFilterActive = !!q || band !== null || kind !== null || unmappedOnly;

  const unmappedCount = useMemo(
    () => systems.filter((s) => s.goal_statement === PLACEHOLDER_GOAL).length,
    [systems],
  );

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
            className="h-8 pl-8"
          />
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Area</p>
          <ul className="space-y-0.5">
            <FilterRow label="All areas" active={band === null} onClick={() => setBand(null)} count={systems.length} />
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
            <FilterRow label="Anything" active={kind === null} onClick={() => setKind(null)} count={systems.length} />
            {ATTACHMENT_KINDS.map((k) =>
              kindCounts[k] ? (
                <FilterRow key={k} label={SYSTEM_KIND_LABEL[k]} active={kind === k} onClick={() => setKind(k)} count={kindCounts[k]} />
              ) : null,
            )}
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
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 overflow-y-auto p-6">
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
                        {anyFilterActive
                          ? `No ${SYSTEM_LAYER_LABEL[g.layer].toLowerCase()} match your filters.`
                          : `No ${SYSTEM_LAYER_LABEL[g.layer].toLowerCase()} written up yet.`}
                      </p>
                    ) : (
                      <ul className="divide-y divide-m-outline-variant">
                        {g.items.map((s) => (
                          <SystemRow key={s.id} system={s} onClick={() => navigate(`/systems/${s.id}`)} />
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

function SystemRow({ system, onClick }: { system: SystemDefinitionWithJoins; onClick: () => void }) {
  const isUnmapped = system.goal_statement === PLACEHOLDER_GOAL;
  const layer = systemLayer(system.kind);
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
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-m-surface-container"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-title-small text-m-on-surface">{system.name}</span>
            {layer === "procedure" && (
              <Badge variant="outline" className="flex-none text-label-small">{SYSTEM_KIND_LABEL[system.kind]}</Badge>
            )}
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
        {/* A policy is prose, not steps — a "0 steps" tag on one reads as a gap. */}
        {layer !== "policy" && (
          <span className="flex-none text-label-small text-m-on-surface-variant">
            {system.step_count} step{system.step_count === 1 ? "" : "s"}
          </span>
        )}
        {system.owner_name ? (
          <span
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-m-secondary-container text-label-small font-semibold text-m-on-secondary-container"
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
    </li>
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

  // A service (or recurring service, or time category) can back exactly one
  // live system — enforced by the partial unique indexes in 0107. Taken
  // options stay visible but disabled: silently omitting them just raises
  // "where did my service go?", and picking one is a 23505 on submit.
  const { data: existing = [] } = useSystemDefinitions();
  const taken = useMemo(() => {
    const t = { service: new Set<string>(), recurring: new Set<string>(), internal: new Set<string>() };
    for (const s of existing) {
      if (s.archived_at) continue;
      if (s.service_id) t.service.add(s.service_id);
      if (s.recurring_service_id) t.recurring.add(s.recurring_service_id);
      if (s.time_category_id) t.internal.add(s.time_category_id);
    }
    return t;
  }, [existing]);


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
                  <option key={s.id} value={s.id} disabled={taken.service.has(s.id)}>
                    {s.name}{taken.service.has(s.id) ? " — already has a procedure" : ""}
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
                  <option key={r.id} value={r.id} disabled={taken.recurring.has(r.id)}>
                    {r.label}{taken.recurring.has(r.id) ? " — already has a procedure" : ""}
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
                  <option key={c.id} value={c.id} disabled={taken.internal.has(c.id)}>
                    {c.label}{taken.internal.has(c.id) ? " — already has a procedure" : ""}
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
          "flex w-full items-center justify-between rounded px-2 py-1 text-left text-body-small",
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
