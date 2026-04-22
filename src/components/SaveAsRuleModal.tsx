import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { hoursToPct } from "@/lib/allocation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Database } from "@/types/db";

type Department = Database["public"]["Tables"]["departments"]["Row"];
type Step = Database["public"]["Tables"]["process_steps"]["Row"];

interface Props {
  open: boolean;
  onClose: () => void;
  steps: Step[];
  departments: Department[];
  priceCents: number;
  onSaved: () => void;
}

export function SaveAsRuleModal({ open, onClose, steps, departments, priceCents, onSaved }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [collision, setCollision] = useState<null | string>(null);
  const [busy, setBusy] = useState(false);

  const pcts = useMemo(() => {
    const hoursByDept: Record<string, number> = {};
    for (const s of steps) {
      if (!s.department_id || s.estimated_hours == null) continue;
      hoursByDept[s.department_id] = (hoursByDept[s.department_id] ?? 0) + Number(s.estimated_hours);
    }
    const rates = Object.fromEntries(departments.map((d) => [d.id, d.hourly_rate_cents]));
    return hoursToPct({ hoursByDept, departmentRates: rates, priceCents });
  }, [steps, departments, priceCents]);

  const deptsById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);

  async function save(mode: "new" | "overwrite") {
    if (!name.trim()) return;
    setBusy(true);
    try {
      let ruleId: string | null = null;

      if (mode === "overwrite") {
        const { data: existing, error: fErr } = await supabase
          .from("rules").select("id").eq("name", name.trim()).maybeSingle();
        if (fErr) throw fErr;
        if (!existing) throw new Error("Rule vanished");
        ruleId = existing.id;

        const { error: dErr } = await supabase
          .from("rule_allocations").delete().eq("rule_id", ruleId);
        if (dErr) throw dErr;

        const { error: uErr } = await supabase
          .from("rules").update({ description: description.trim() || null }).eq("id", ruleId);
        if (uErr) throw uErr;
      } else {
        const { data: created, error: cErr } = await supabase
          .from("rules")
          .insert({ name: name.trim(), description: description.trim() || null })
          .select()
          .single();
        if (cErr) {
          if (cErr.code === "23505") {
            setCollision(name.trim());
            return;
          }
          throw cErr;
        }
        ruleId = created.id;
      }

      const rows = Object.entries(pcts).map(([dept_id, pct]) => ({
        rule_id: ruleId!,
        department_id: dept_id,
        pct,
      }));
      if (rows.length > 0) {
        const { error: iErr } = await supabase.from("rule_allocations").insert(rows);
        if (iErr) throw iErr;
      }

      toast.success(`Rule "${name.trim()}" saved`);
      onSaved();
      onClose();
      setName("");
      setDescription("");
      setCollision(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-md bg-card p-6 shadow-lg">
        <h2 className="text-lg font-semibold">Save checklist as rule</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Converts the checklist's dept totals into a reusable rule. This service keeps its
          checklist — the rule is available for other services to use.
        </p>

        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); setCollision(null); }}
              placeholder="e.g. Dev-heavy SEO"
            />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-1 rounded border p-3 text-xs">
            <div className="font-medium">Preview</div>
            {Object.entries(pcts).map(([dept_id, pct]) => (
              <div key={dept_id} className="flex justify-between">
                <span>{deptsById.get(dept_id)?.name ?? "Unknown"}</span>
                <span className="tabular-nums">{pct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>

        {collision && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
            A rule named <span className="font-medium">{collision}</span> already exists.
            Overwrite its allocations, or choose a different name.
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          {collision ? (
            <>
              <Button variant="outline" onClick={() => save("overwrite")} disabled={busy}>Overwrite</Button>
              <Button onClick={() => setCollision(null)} disabled={busy}>Edit name</Button>
            </>
          ) : (
            <Button onClick={() => save("new")} disabled={busy || !name.trim()}>Save rule</Button>
          )}
        </div>
      </div>
    </div>
  );
}
