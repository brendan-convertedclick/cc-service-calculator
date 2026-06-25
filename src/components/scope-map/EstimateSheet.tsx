import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useServices } from "@/hooks/useServices";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  rollupCE,
  type CELineKind,
  type ChangeEstimateLineItem,
} from "@/types/change-estimates";
import type { BriefTaskSowPlacement } from "@/types/sow-placements";

type DraftLine = Omit<ChangeEstimateLineItem, "id" | "change_estimate_id"> & { tmpId: string };

const FMT_ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const DEFAULT_REASON = "Out-of-scope items from brief intake";

// change_estimates / change_estimate_line_items (0057, relaxed by 0061) and
// project_events (0055) aren't in the generated Database types yet — write
// untyped and cast rows (same pattern as useRetainerSubItems).
const sb = supabase as unknown as SupabaseClient;

export interface EstimateSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  brief: { id: string; client_id: string | null; parent_project_id: string | null };
  /**
   * Selected new_billable placements — one prefilled line each. The caller only
   * ever passes billable items (out_of_scope lines are excluded upstream).
   */
  items: BriefTaskSowPlacement[];
}

/**
 * Builds a Change Estimate (source 'intake_outside_scope') from the new-billable
 * items selected on the scope map. Modelled on AdjustPlanSheet; unlike it,
 * project_id and created_by may be null (intake CE for a new brief under the
 * shared login — relaxed by migration 0061).
 */
export function EstimateSheet({ open, onOpenChange, brief, items }: EstimateSheetProps) {
  const navigate = useNavigate();
  const { currentUserId } = useAuth();
  const { data: services } = useServices();

  const [reason, setReason] = useState(DEFAULT_REASON);
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);
  const prefilledRef = useRef(false);

  const activeServices = useMemo(
    () => (services ?? []).filter((s) => s.status === "active"),
    [services],
  );
  const serviceOptions = useMemo(
    () => activeServices.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` })),
    [activeServices],
  );
  const serviceById = useMemo(
    () => new Map(activeServices.map((s) => [s.id, s])),
    [activeServices],
  );

  // Prefill one line per selected item each time the sheet opens.
  useEffect(() => {
    if (!open) {
      prefilledRef.current = false;
      return;
    }
    if (prefilledRef.current) return;
    prefilledRef.current = true;
    setReason(DEFAULT_REASON);
    setSummary("");
    setLines(
      items.map((item, i) => {
        const matched = item.suggested_service_id
          ? serviceById.get(item.suggested_service_id)
          : undefined;
        // Carry the extracted quantity through (Scope Ledger Rail) instead of
        // hardcoding 1 — a positive, finite count, else fall back to 1.
        const qty =
          typeof item.quantity === "number" &&
          Number.isFinite(item.quantity) &&
          item.quantity > 0
            ? item.quantity
            : 1;
        return {
          tmpId: crypto.randomUUID(),
          service_id: item.suggested_service_id,
          description:
            [item.item_name, item.item_description].filter(Boolean).join(" — ").trim() ||
            item.task_ref,
          qty,
          unit_points: 1,
          unit_value_cents: item.estimated_cents ?? matched?.sell_price_cents ?? 0,
          line_kind: "add" as CELineKind,
          target_task_id: null,
          sort_order: i,
        };
      }),
    );
  }, [open, items, serviceById]);

  const totals = useMemo(
    () => rollupCE(lines.map((l) => ({ id: l.tmpId, change_estimate_id: "x", ...l }))),
    [lines],
  );

  const updateLine = (tmpId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.tmpId === tmpId ? { ...l, ...patch } : l)));
  };

  const removeLine = (tmpId: string) => {
    setLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  };

  const saveDraft = async (): Promise<string | null> => {
    if (!brief.client_id) {
      toast.error("Link this brief to a client before building an estimate.");
      return null;
    }
    setSaving(true);
    try {
      const { data: ce, error: ceErr } = await sb
        .from("change_estimates")
        .insert({
          project_id: brief.parent_project_id, // null for a brief with no project yet
          brief_id: brief.id,
          client_id: brief.client_id,
          source: "intake_outside_scope",
          status: "draft",
          reason,
          summary,
          delta_points: totals.delta_points,
          delta_value_cents: totals.delta_value_cents,
          created_by: currentUserId ?? null, // null under the shared team@ login
        })
        .select("id")
        .single();
      if (ceErr) {
        toast.error(ceErr.message);
        return null;
      }
      const ceId = (ce as { id: string }).id;
      if (lines.length > 0) {
        const payload = lines.map((l, i) => ({
          change_estimate_id: ceId,
          service_id: l.service_id,
          description: l.description,
          qty: l.qty,
          unit_points: l.unit_points,
          unit_value_cents: l.unit_value_cents,
          line_kind: l.line_kind,
          target_task_id: l.target_task_id,
          sort_order: i,
        }));
        const { error: liErr } = await sb
          .from("change_estimate_line_items")
          .insert(payload);
        if (liErr) {
          toast.error(liErr.message);
          return ceId;
        }
      }
      if (brief.parent_project_id) {
        const { error: evErr } = await sb
          .from("project_events")
          .insert({
            project_id: brief.parent_project_id,
            event_type: "ce_drafted",
            payload: {
              change_estimate_id: ceId,
              delta_points: totals.delta_points,
              delta_value_cents: totals.delta_value_cents,
            },
            occurred_at: new Date().toISOString(),
          });
        if (evErr) toast.error(`Event log failed: ${evErr.message}`);
      }
      return ceId;
    } finally {
      setSaving(false);
    }
  };

  const saveAndCompose = async () => {
    const ceId = await saveDraft();
    if (!ceId) return;
    toast.success("Estimate draft saved.");
    onOpenChange(false);
    navigate(
      `/comms/new?project_id=${brief.parent_project_id}&client_id=${brief.client_id}&ce_id=${ceId}`,
    );
  };

  const saveAndOpenBuilder = async () => {
    const ceId = await saveDraft();
    if (!ceId) return;
    toast.success("Estimate draft saved.");
    onOpenChange(false);
    navigate(`/briefs/${brief.id}/builder`);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Build cost estimate</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="es-summary">Summary (one line, used in the email)</Label>
            <Input
              id="es-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Mobile app build + extra landing pages beyond the retainer"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="es-reason">Why is this needed?</Label>
            <Textarea
              id="es-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-title-small">Line items</h3>
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed border-m-outline-variant px-3 py-6 text-center text-body-small text-m-on-surface-variant">
                No items selected. Pick outside-scope items on the map first.
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((l) => (
                  <li
                    key={l.tmpId}
                    className="grid grid-cols-[200px,1fr,70px,90px,110px,40px] items-center gap-2 rounded-md border border-m-outline-variant bg-m-surface px-3 py-2"
                  >
                    <Combobox
                      options={serviceOptions}
                      value={l.service_id ?? ""}
                      onChange={(v) => {
                        const svc = serviceById.get(v);
                        updateLine(l.tmpId, {
                          service_id: v || null,
                          ...(svc ? { unit_value_cents: svc.sell_price_cents } : {}),
                        });
                      }}
                      placeholder="Match a service…"
                    />
                    <Input
                      value={l.description}
                      onChange={(e) => updateLine(l.tmpId, { description: e.target.value })}
                      placeholder="Description"
                    />
                    <Input
                      type="number"
                      min={0.25}
                      step={0.25}
                      value={l.qty}
                      onChange={(e) => updateLine(l.tmpId, { qty: Number(e.target.value) })}
                      aria-label="Quantity"
                    />
                    <Input
                      type="number"
                      min={0}
                      step={0.25}
                      value={l.unit_points}
                      onChange={(e) =>
                        updateLine(l.tmpId, { unit_points: Number(e.target.value) })
                      }
                      placeholder="pt"
                      aria-label="Unit points"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={l.unit_value_cents / 100}
                      onChange={(e) =>
                        updateLine(l.tmpId, {
                          unit_value_cents: Math.round(Number(e.target.value) * 100),
                        })
                      }
                      placeholder="ZAR"
                      aria-label="Unit value (ZAR)"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLine(l.tmpId)}
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between rounded-md border border-m-outline bg-m-surface-container px-4 py-3 text-body-medium">
            <span className="text-m-on-surface-variant">Estimate total</span>
            <div className="flex items-center gap-6">
              <span>
                <strong>
                  {totals.delta_points >= 0 ? "+" : ""}
                  {totals.delta_points}
                </strong>{" "}
                pts
              </span>
              <span>
                <strong>{FMT_ZAR.format(totals.delta_value_cents / 100)}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={saving || lines.length === 0}
              onClick={async () => {
                const id = await saveDraft();
                if (id) {
                  toast.success("Saved as draft.");
                  onOpenChange(false);
                }
              }}
            >
              Save draft
            </Button>
            {brief.parent_project_id ? (
              <Button
                disabled={saving || lines.length === 0 || !summary.trim()}
                onClick={saveAndCompose}
                className="gap-2"
              >
                <Send className="h-4 w-4" />
                Save & compose email
              </Button>
            ) : (
              <Button
                disabled={saving || lines.length === 0}
                onClick={saveAndOpenBuilder}
                className="gap-2"
              >
                Save & open builder
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default EstimateSheet;
