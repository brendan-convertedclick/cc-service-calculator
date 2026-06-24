import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ServicePicker } from "@/components/ServicePicker";
import { retainerRowPreview } from "@/lib/retainerMath";
import { useServices } from "@/hooks/useServices";
import { useTeam } from "@/hooks/useTeam";
import {
  useRetainerServices,
  useUpdateRetainerServices,
  useProvisionRetainerNow,
  type RetainerServiceInput,
} from "@/hooks/useRetainerServices";

const CADENCES = ["daily", "weekly", "biweekly", "monthly", "custom"] as const;
type Cadence = (typeof CADENCES)[number];

type Row = {
  rowId: string;
  id?: string; // existing DB row id (undefined = new)
  service_id: string;
  cadence: Cadence;
  occurrences_per_month: number;
  points_per_occurrence: number;
  default_assignees: string[];
  is_live_eligible: boolean;
  occurrence_labels: string[];
};

let seq = 0;
const nextRowId = () => `row-${seq++}`;

function rowIsValid(r: Row): boolean {
  return (
    !!r.service_id &&
    r.occurrences_per_month > 0 &&
    r.points_per_occurrence > 0 &&
    r.default_assignees.length >= 1
  );
}

export function RetainerServicesEditor({ projectId }: { projectId: string }) {
  const { data: services = [] } = useServices();
  const { data: team = [] } = useTeam();
  const { data: loaded } = useRetainerServices(projectId);
  const update = useUpdateRetainerServices();
  const provision = useProvisionRetainerNow();

  const [rows, setRows] = useState<Row[]>([]);
  // Initialise once per project; re-sync after a save (which assigns ids to new
  // rows). Reset via initedRef so a refetch re-seeds from canonical server state.
  const initedRef = useRef<string | null>(null);
  useEffect(() => {
    if (loaded && initedRef.current !== projectId) {
      setRows(
        loaded.map((s) => ({
          rowId: nextRowId(),
          id: s.id,
          service_id: s.service_id,
          cadence: (CADENCES as readonly string[]).includes(s.cadence) ? (s.cadence as Cadence) : "monthly",
          occurrences_per_month: Number(s.occurrences_per_month),
          points_per_occurrence: Number(s.points_per_occurrence),
          default_assignees: s.default_assignees ?? [],
          is_live_eligible: s.is_live_eligible,
          occurrence_labels: s.occurrence_labels ?? [],
        })),
      );
      initedRef.current = projectId;
    }
  }, [loaded, projectId]);

  const pickedServiceIds = useMemo(() => new Set(rows.map((r) => r.service_id)), [rows]);
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? "(unknown service)";
  const valid = rows.length > 0 && rows.every(rowIsValid);

  function addServiceRow(serviceId: string) {
    setRows((prev) => [
      ...prev,
      {
        rowId: nextRowId(),
        service_id: serviceId,
        cadence: "monthly",
        occurrences_per_month: 1,
        points_per_occurrence: 1,
        default_assignees: [],
        is_live_eligible: false,
        occurrence_labels: [],
      },
    ]);
  }
  function patchRow(rowId: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }
  function removeRow(rowId: string) {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  }
  function toggleAssignee(rowId: string, memberId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const has = r.default_assignees.includes(memberId);
        return {
          ...r,
          default_assignees: has
            ? r.default_assignees.filter((id) => id !== memberId)
            : [...r.default_assignees, memberId],
        };
      }),
    );
  }

  function setLabel(rowId: string, index: number, value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowId !== rowId) return r;
        const labels = [...r.occurrence_labels];
        labels[index] = value;
        return { ...r, occurrence_labels: labels };
      }),
    );
  }

  function save() {
    if (!valid) return;
    const payload: RetainerServiceInput[] = rows.map((r) => ({
      id: r.id,
      service_id: r.service_id,
      cadence: r.cadence,
      occurrences_per_month: r.occurrences_per_month,
      points_per_occurrence: r.points_per_occurrence,
      default_assignees: r.default_assignees,
      is_live_eligible: r.is_live_eligible,
      occurrence_labels: r.occurrence_labels,
    }));
    update.mutate(
      { projectId, services: payload },
      {
        onSuccess: (res) => {
          initedRef.current = null; // re-seed rows (new rows gain ids) on refetch
          const parts = [
            res.updated ? `${res.updated} updated` : "",
            res.inserted ? `${res.inserted} added` : "",
            res.deleted ? `${res.deleted} removed` : "",
          ].filter(Boolean);
          toast.success(`Services saved${parts.length ? ` — ${parts.join(", ")}` : ""}`);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save services"),
      },
    );
  }

  function provisionNow() {
    provision.mutate(projectId, {
      onSuccess: (res) =>
        toast.success(
          `Provisioned this period${res.created ? ` — ${res.created} new` : " — nothing new"}`,
        ),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to provision"),
    });
  }

  return (
    <div className="space-y-3">
      <ServicePicker
        excludeIds={pickedServiceIds}
        onPick={addServiceRow}
        placeholder="Search services to add a recurring row…"
      />

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-m-outline-variant p-6 text-center text-sm text-muted-foreground">
          No recurring services. Add at least one above.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.rowId} className="space-y-3 rounded-md border border-m-outline-variant bg-m-surface p-3">
              <div className="flex items-start justify-between">
                <div className="text-title-small">{serviceName(r.service_id)}</div>
                <Button variant="ghost" size="icon" onClick={() => removeRow(r.rowId)} aria-label="Remove service">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-label-small text-m-on-surface-variant">Cadence</Label>
                  <select
                    value={r.cadence}
                    onChange={(e) => patchRow(r.rowId, { cadence: e.target.value as Cadence })}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {CADENCES.map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label-small text-m-on-surface-variant">Occurrences / month</Label>
                  <Input
                    type="number"
                    min="1"
                    value={r.occurrences_per_month}
                    onChange={(e) => patchRow(r.rowId, { occurrences_per_month: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-label-small text-m-on-surface-variant">Points / occurrence</Label>
                  <Input
                    type="number"
                    min="1"
                    value={r.points_per_occurrence}
                    onChange={(e) => patchRow(r.rowId, { points_per_occurrence: Number(e.target.value) })}
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-body-small text-m-on-surface">
                    <input
                      type="checkbox"
                      checked={r.is_live_eligible}
                      onChange={(e) => patchRow(r.rowId, { is_live_eligible: e.target.checked })}
                    />
                    Live-eligible
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-label-small text-m-on-surface-variant">Assignees (at least one)</Label>
                <div className="flex flex-wrap gap-2">
                  {team.map((m) => {
                    const selected = r.default_assignees.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleAssignee(r.rowId, m.id)}
                        className={
                          "flex items-center gap-1 rounded-full border px-3 py-1 text-label-small transition-colors " +
                          (selected
                            ? "border-m-primary bg-m-primary text-m-on-primary"
                            : "border-m-outline-variant text-m-on-surface-variant hover:text-m-on-surface")
                        }
                      >
                        {selected && <Check className="h-3 w-3" />}
                        {m.full_name}
                      </button>
                    );
                  })}
                </div>
              </div>
              {!r.is_live_eligible &&
                Math.round(r.occurrences_per_month) >= 1 &&
                Math.round(r.occurrences_per_month) <= 20 && (
                  <div className="space-y-1.5">
                    <Label className="text-label-small text-m-on-surface-variant">
                      Task labels (optional — one per occurrence, e.g. website names; persists each month)
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {Array.from({ length: Math.round(r.occurrences_per_month) }).map((_, i) => (
                        <Input
                          key={i}
                          value={r.occurrence_labels[i] ?? ""}
                          onChange={(e) => setLabel(r.rowId, i, e.target.value)}
                          placeholder={`Task ${i + 1} label`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              <p className="text-label-small text-m-on-surface-variant">
                {retainerRowPreview(r.occurrences_per_month, r.points_per_occurrence, r.default_assignees.length, r.is_live_eligible)}
              </p>
              {!rowIsValid(r) && (
                <p className="text-label-small text-m-error">
                  Needs positive occurrences and points, and at least one assignee.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button
          variant="secondary"
          size="sm"
          onClick={provisionNow}
          disabled={provision.isPending}
          title="Create this month's ClickUp tasks for any newly-added services"
        >
          {provision.isPending ? "Provisioning…" : "Provision now"}
        </Button>
        <Button size="sm" onClick={save} disabled={!valid || update.isPending}>
          {update.isPending ? "Saving…" : "Save services"}
        </Button>
      </div>
      <p className="text-label-small text-m-on-surface-variant">
        Changes apply to next month's provisioning. Use "Provision now" to push newly-added services into the current month.
      </p>
    </div>
  );
}
