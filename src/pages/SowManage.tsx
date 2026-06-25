// src/pages/SowManage.tsx
//
// Scope Composer management surface (/sow/manage, opened via the cog). Full CRUD
// over the typed variable registry — the values templates resolve against.

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDeleteSowVariable,
  useSowVariables,
  useUpsertSowVariable,
} from "@/hooks/useSowComposer";
import { variableTypeSchema, type VariableDef, type VariableType } from "@/types/sow-composer";

const TYPES = variableTypeSchema.options;

function parseDefault(type: VariableType, raw: string): unknown {
  if (raw === "") return null;
  if (type === "number" || type === "currency_cents" || type === "percent") return Number(raw);
  if (type === "boolean") return raw === "true";
  if (type === "enum") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return raw;
}

function defaultToString(v: VariableDef): string {
  if (v.default_value === null || v.default_value === undefined) return "";
  if (Array.isArray(v.default_value)) return v.default_value.join(", ");
  return String(v.default_value);
}

export function SowManage() {
  const navigate = useNavigate();
  const { data: variables = [], isLoading } = useSowVariables(null);
  const upsert = useUpsertSowVariable();
  const del = useDeleteSowVariable();
  const [editing, setEditing] = useState<VariableDef | "new" | null>(null);

  const remove = (v: VariableDef) => {
    if (!window.confirm(`Delete variable "${v.key}"?`)) return;
    del.mutate(v.id, {
      onSuccess: () => toast.success("Variable deleted"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete"),
    });
  };

  return (
    <div className="max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Back to Scope Composer" onClick={() => navigate("/sow")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-headline-medium">Manage variables</h1>
            <p className="mt-1 text-body-medium text-m-on-surface-variant">
              The typed registry every template resolves against. Create once, override per client.
            </p>
          </div>
        </div>
        <Button onClick={() => setEditing("new")} className="gap-1">
          <Plus className="h-4 w-4" />
          New variable
        </Button>
      </div>

      <Card className="border-m-outline-variant">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Label</TableHead>
              <TableHead className="w-32">Type</TableHead>
              <TableHead>Default / expression</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-m-on-surface-variant">
                  Loading…
                </TableCell>
              </TableRow>
            ) : variables.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-m-on-surface-variant">
                  No variables yet.
                </TableCell>
              </TableRow>
            ) : (
              variables.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-body-small text-m-on-surface">{v.key}</TableCell>
                  <TableCell className="text-body-small">{v.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-label-small">
                      {v.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-body-small text-m-on-surface-variant">
                    {v.type === "computed" ? v.expression : defaultToString(v)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${v.key}`} onClick={() => setEditing(v)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-m-error"
                        aria-label={`Delete ${v.key}`}
                        onClick={() => remove(v)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <VariableDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSave={(input) =>
          upsert.mutate(input, {
            onSuccess: () => {
              toast.success("Saved");
              setEditing(null);
            },
            onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
          })
        }
      />
    </div>
  );
}

function VariableDialog({
  value,
  onClose,
  onSave,
}: {
  value: VariableDef | "new" | null;
  onClose: () => void;
  onSave: (input: Partial<VariableDef> & { key: string; type: VariableType }) => void;
}) {
  const isNew = value === "new";
  const existing = value && value !== "new" ? value : null;
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<VariableType>("text");
  const [defaultRaw, setDefaultRaw] = useState("");
  const [expression, setExpression] = useState("");

  useEffect(() => {
    if (!value) return;
    if (existing) {
      setKey(existing.key);
      setLabel(existing.label ?? "");
      setType(existing.type);
      setDefaultRaw(defaultToString(existing));
      setExpression(existing.expression ?? "");
    } else {
      setKey("");
      setLabel("");
      setType("text");
      setDefaultRaw("");
      setExpression("");
    }
  }, [value, existing]);

  const valid = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(key);

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "New variable" : "Edit variable"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="v-key">Key (dotted, e.g. pricing.hourly_rate)</Label>
            <Input id="v-key" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" />
            {key && !valid && <p className="text-label-small text-m-error">Use a dotted lowercase key.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="v-label">Label</Label>
            <Input id="v-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={(t) => setType(t as VariableType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {type === "computed" ? (
            <div className="space-y-1">
              <Label htmlFor="v-expr">Expression</Label>
              <Input
                id="v-expr"
                value={expression}
                onChange={(e) => setExpression(e.target.value)}
                placeholder="pricing.subtotal_cents * (1 + agency.vat_pct / 100)"
                className="font-mono"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="v-default">Default value</Label>
              <Input
                id="v-default"
                value={defaultRaw}
                onChange={(e) => setDefaultRaw(e.target.value)}
                placeholder={type === "enum" ? "comma,separated,options" : ""}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={() =>
              onSave({
                id: existing?.id,
                key: key.trim(),
                label: label.trim() || null,
                type,
                scope: type === "computed" ? "computed" : "global",
                default_value: type === "computed" ? null : parseDefault(type, defaultRaw),
                expression: type === "computed" ? expression.trim() : null,
              })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
