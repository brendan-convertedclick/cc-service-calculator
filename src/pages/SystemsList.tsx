// src/pages/SystemsList.tsx
//
// /systems — named, owned, goal-bearing ways of doing something. Grouped by
// band, left filter rail matches the SowList/ServicesList standard.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  PLACEHOLDER_GOAL,
  SYSTEM_BANDS,
  SYSTEM_BAND_LABEL,
  SYSTEM_KIND_LABEL,
  useCreateSystem,
  useRecurringServiceOptions,
  useSystemDefinitions,
  type SystemBand,
  type SystemDefinitionWithJoins,
} from "@/hooks/useSystemDefinitions";
import { useServices } from "@/hooks/useServices";
import { useTimeCategories } from "@/hooks/useOngoingTasks";
import type { Database } from "@/types/db";

type SystemKind = Database["public"]["Enums"]["system_kind"];

const UNBANDED = "unbanded";

function isBand(b: string | null): b is SystemBand {
  return !!b && (SYSTEM_BANDS as readonly string[]).includes(b);
}

function initials(name: string): string {
  return name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
}

export function SystemsList() {
  const navigate = useNavigate();
  const { data: systems = [], isLoading } = useSystemDefinitions();
  const [search, setSearch] = useState("");
  const [band, setBand] = useState<string | null>(null);
  const [kind, setKind] = useState<SystemKind | null>(null);
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [creating, setCreating] = useState(false);

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

  const grouped = useMemo(() => {
    const byBand = new Map<string, SystemDefinitionWithJoins[]>();
    for (const s of filtered) {
      const key = isBand(s.band) ? s.band : UNBANDED;
      const arr = byBand.get(key) ?? [];
      arr.push(s);
      byBand.set(key, arr);
    }
    return [...SYSTEM_BANDS, UNBANDED]
      .map((k) => ({
        key: k,
        label: k === UNBANDED ? "Unbanded" : SYSTEM_BAND_LABEL[k as SystemBand],
        items: byBand.get(k) ?? [],
      }))
      .filter((g) => g.items.length > 0);
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
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Band</p>
          <ul className="space-y-0.5">
            <FilterRow label="All bands" active={band === null} onClick={() => setBand(null)} count={systems.length} />
            {[...SYSTEM_BANDS, UNBANDED].map((b) =>
              bandCounts[b] ? (
                <FilterRow
                  key={b}
                  label={b === UNBANDED ? "Unbanded" : SYSTEM_BAND_LABEL[b as SystemBand]}
                  active={band === b}
                  onClick={() => setBand(b)}
                  count={bandCounts[b]}
                />
              ) : null,
            )}
          </ul>
        </div>

        <div>
          <p className="mb-1.5 text-label-medium font-medium text-m-on-surface-variant">Kind</p>
          <ul className="space-y-0.5">
            <FilterRow label="All kinds" active={kind === null} onClick={() => setKind(null)} count={systems.length} />
            {(Object.keys(SYSTEM_KIND_LABEL) as SystemKind[]).map((k) =>
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
        <div className="mb-6 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-headline-medium">Systems</h1>
            <p className="mt-1 text-body-medium text-m-on-surface-variant">
              Named, owned, goal-bearing ways of doing something — the process behind the price.
            </p>
          </div>
          <Button onClick={() => setCreating(true)} className="gap-1">
            <Plus className="h-4 w-4" /> New system
          </Button>
        </div>

        {isLoading ? (
          <p className="text-body-medium text-m-on-surface-variant">Loading…</p>
        ) : grouped.length === 0 ? (
          <Card className="border-m-outline-variant">
            <CardContent className="p-10 text-center text-body-medium text-m-on-surface-variant">
              No systems match your filters.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            {grouped.map((g) => (
              <section key={g.key}>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-title-medium text-m-on-surface">{g.label}</h2>
                  <span className="text-label-medium text-m-on-surface-variant">{g.items.length}</span>
                </div>
                <Card className="overflow-hidden border-m-outline-variant">
                  <CardContent className="p-0">
                    <ul className="divide-y divide-m-outline-variant">
                      {g.items.map((s) => (
                        <SystemRow key={s.id} system={s} onClick={() => navigate(`/systems/${s.id}`)} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </section>
            ))}
          </div>
        )}
      </div>

      <NewSystemDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => navigate(`/systems/${id}`)}
      />
    </div>
  );
}

function SystemRow({ system, onClick }: { system: SystemDefinitionWithJoins; onClick: () => void }) {
  const isUnmapped = system.goal_statement === PLACEHOLDER_GOAL;
  const linkLabel =
    system.kind === "service"
      ? system.service_name
      : system.kind === "recurring"
        ? system.recurring_service_name
        : system.kind === "internal"
          ? system.time_category_label
          : null;

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
            <Badge variant="outline" className="flex-none text-label-small">{SYSTEM_KIND_LABEL[system.kind]}</Badge>
            {isUnmapped && (
              <Badge variant="warning" className="flex-none gap-1 text-label-small">
                <AlertTriangle className="h-3 w-3" /> No goal
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-label-small text-m-on-surface-variant">
            {linkLabel ?? "—"}
          </p>
        </div>
        <span className="flex-none text-label-small text-m-on-surface-variant">
          {system.step_count} step{system.step_count === 1 ? "" : "s"}
        </span>
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
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const createSystem = useCreateSystem();
  const { data: services = [] } = useServices();
  const { data: timeCategories = [] } = useTimeCategories();
  const { data: recurringOptions = [] } = useRecurringServiceOptions();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<SystemKind>("service");
  const [goal, setGoal] = useState("");
  const [band, setBand] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [recurringId, setRecurringId] = useState("");
  const [timeCategoryId, setTimeCategoryId] = useState("");

  function reset() {
    setName("");
    setKind("service");
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
      toast.error("Goal is required — a system can't be created without one");
      return;
    }
    if (kind === "service" && !serviceId) {
      toast.error("Pick the service this system belongs to");
      return;
    }
    if (kind === "recurring" && !recurringId) {
      toast.error("Pick the recurring service this system belongs to");
      return;
    }
    if (kind === "internal" && !timeCategoryId) {
      toast.error("Pick the time category this system attributes to");
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
          toast.success("System created");
          reset();
          onCreated(s.id);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create system"),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeAndReset()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New system</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="sys-name">Name</Label>
            <Input id="sys-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Outbound sales" />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sys-kind">Kind</Label>
            <select
              id="sys-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as SystemKind)}
              className="h-10 w-full rounded-md border border-m-outline bg-m-surface px-3 text-body-medium text-m-on-surface"
            >
              {(Object.keys(SYSTEM_KIND_LABEL) as SystemKind[]).map((k) => (
                <option key={k} value={k}>{SYSTEM_KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>

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
                  <option key={s.id} value={s.id}>{s.name}</option>
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
                  <option key={r.id} value={r.id}>{r.label}</option>
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
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="sys-band">Band</Label>
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
              placeholder="What does this system exist to achieve?"
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
