import { useMemo, useState } from "react";
import { Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { rollupCE, type CELineKind, type ChangeEstimateLineItem } from "@/types/change-estimates";

type DraftLine = Omit<ChangeEstimateLineItem, "id" | "change_estimate_id"> & { tmpId: string };

const FMT_ZAR = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });

export function AdjustPlanSheet({
  open,
  onOpenChange,
  projectId,
  clientId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  clientId: string;
}) {
  const navigate = useNavigate();
  const { currentUserId } = useAuth();
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  const totals = useMemo(
    () =>
      rollupCE(
        lines.map((l) => ({
          id: l.tmpId,
          change_estimate_id: "x",
          ...l,
        })),
      ),
    [lines],
  );

  const addLine = (kind: CELineKind) => {
    setLines((prev) => [
      ...prev,
      {
        tmpId: crypto.randomUUID(),
        service_id: null,
        description: "",
        qty: 1,
        unit_points: 1,
        unit_value_cents: 0,
        line_kind: kind,
        target_task_id: null,
        sort_order: prev.length,
      },
    ]);
  };

  const updateLine = (tmpId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => (l.tmpId === tmpId ? { ...l, ...patch } : l)));
  };

  const removeLine = (tmpId: string) => {
    setLines((prev) => prev.filter((l) => l.tmpId !== tmpId));
  };

  const saveDraft = async (): Promise<string | null> => {
    if (!currentUserId) {
      toast.error("Sign-in required.");
      return null;
    }
    setSaving(true);
    try {
      const { data: ce, error: ceErr } = await supabase
        .from("change_estimates")
        .insert({
          project_id: projectId,
          client_id: clientId,
          source: "mid_project_adjust",
          status: "draft",
          reason,
          summary,
          delta_points: totals.delta_points,
          delta_value_cents: totals.delta_value_cents,
          created_by: currentUserId,
        })
        .select("id")
        .single();
      if (ceErr) {
        toast.error(ceErr.message);
        return null;
      }
      const ceId = (ce as { id: string }).id;
      if (lines.length > 0) {
        const payload = lines.map((l) => ({
          change_estimate_id: ceId,
          service_id: l.service_id,
          description: l.description,
          qty: l.qty,
          unit_points: l.unit_points,
          unit_value_cents: l.unit_value_cents,
          line_kind: l.line_kind,
          target_task_id: l.target_task_id,
          sort_order: l.sort_order,
        }));
        const { error: liErr } = await supabase
          .from("change_estimate_line_items")
          .insert(payload);
        if (liErr) {
          toast.error(liErr.message);
          return ceId;
        }
      }
      // Phase 5 event log
      await supabase
        .from("project_events")
        .insert({
          project_id: projectId,
          event_type: "ce_drafted",
          payload: {
            change_estimate_id: ceId,
            delta_points: totals.delta_points,
            delta_value_cents: totals.delta_value_cents,
          },
          occurred_at: new Date().toISOString(),
        });
      return ceId;
    } finally {
      setSaving(false);
    }
  };

  const saveAndCompose = async () => {
    const ceId = await saveDraft();
    if (!ceId) return;
    toast.success("Draft saved.");
    onOpenChange(false);
    // Hand off to ComposeEmail (Phase 6) with context.
    navigate(
      `/comms/new?project_id=${projectId}&client_id=${clientId}&ce_id=${ceId}`,
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Adjust plan</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label htmlFor="ap-summary">Summary (one line, used in the email)</Label>
            <Input
              id="ap-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Add extra revision rounds + remove unused integration"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ap-reason">Why is this needed?</Label>
            <Textarea
              id="ap-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-title-small">Line items</h3>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => addLine("add")} className="gap-1">
                  <Plus className="h-3 w-3" /> Add
                </Button>
                <Button variant="outline" size="sm" onClick={() => addLine("reduce")}>
                  Reduce
                </Button>
                <Button variant="outline" size="sm" onClick={() => addLine("cancel")}>
                  Cancel
                </Button>
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed border-m-outline-variant px-3 py-6 text-center text-body-small text-m-on-surface-variant">
                No line items yet. Add additions, reductions, or cancellations above.
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((l) => (
                  <li
                    key={l.tmpId}
                    className="grid grid-cols-[120px,1fr,80px,100px,120px,40px] items-center gap-2 rounded-md border border-m-outline-variant bg-m-surface px-3 py-2"
                  >
                    <Select
                      value={l.line_kind}
                      onValueChange={(v) => updateLine(l.tmpId, { line_kind: v as CELineKind })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="add">Add</SelectItem>
                        <SelectItem value="reduce">Reduce</SelectItem>
                        <SelectItem value="cancel">Cancel</SelectItem>
                      </SelectContent>
                    </Select>
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
                    />
                    <Input
                      type="number"
                      min={0}
                      step={0.25}
                      value={l.unit_points}
                      onChange={(e) => updateLine(l.tmpId, { unit_points: Number(e.target.value) })}
                      placeholder="pt"
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
            <span className="text-m-on-surface-variant">CE delta</span>
            <div className="flex items-center gap-6">
              <span>
                <strong>{totals.delta_points >= 0 ? "+" : ""}{totals.delta_points}</strong> pts
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
            <Button
              disabled={saving || lines.length === 0 || !summary.trim()}
              onClick={saveAndCompose}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              Save & compose email
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
