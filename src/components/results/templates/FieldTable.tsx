// src/components/results/templates/FieldTable.tsx
//
// One phase's metric table (Plan or Results) inside the template editor.
// Mirrors the mockup's field row: star, name, grid label, type, target,
// retire/restore.

import { Star, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { TYPE_LABELS, NUMERIC_TYPES, type DraftField } from "./types";

export function FieldTable({
  phase,
  fields,
  planFields,
  lockedIds,
  onChange,
  onToggleStar,
  onToggleRetire,
  onAdd,
}: {
  phase: "plan" | "result";
  fields: DraftField[];
  /** Live numeric plan fields the whole template offers as a target — only
   * ones already saved (have an id) can be targeted, since target_field_id
   * is a DB foreign key. */
  planFields: DraftField[];
  lockedIds: Set<string>;
  onChange: (key: string, patch: Partial<DraftField>) => void;
  onToggleStar: (key: string) => void;
  onToggleRetire: (key: string) => void;
  onAdd: () => void;
}) {
  const rows = fields.filter((f) => f.phase === phase);

  return (
    <div className="grid gap-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Star</span>★
            </TableHead>
            <TableHead>Metric</TableHead>
            <TableHead>Grid label</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Target</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((f) => {
            const locked = !!f.id && lockedIds.has(f.id);
            const canStar = f.phase === "result" && !f.retired_at;
            const canTarget = f.phase === "result" && NUMERIC_TYPES.includes(f.type);
            return (
              <TableRow key={f._key} className={cn(f.retired_at && "opacity-60")}>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => onToggleStar(f._key)}
                    disabled={!canStar}
                    aria-pressed={f.star}
                    aria-label={`Show ${f.label} on the grid`}
                    className={cn(
                      "text-m-outline transition-colors disabled:cursor-default disabled:opacity-25",
                      f.star && "text-m-primary",
                    )}
                  >
                    <Star className="h-4 w-4" fill={f.star ? "currentColor" : "none"} />
                  </button>
                </TableCell>
                <TableCell>
                  <Input
                    aria-label="Metric name"
                    value={f.label}
                    disabled={!!f.retired_at}
                    onChange={(e) => onChange(f._key, { label: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    aria-label="Label in the grid"
                    placeholder="grid label"
                    value={f.short_label ?? ""}
                    disabled={!!f.retired_at || f.phase !== "result"}
                    onChange={(e) => onChange(f._key, { short_label: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  {locked ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="flex items-center gap-1 text-label-medium text-m-on-surface-variant">
                          {TYPE_LABELS[f.type]} <Lock className="h-3 w-3" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Has data, so the type is locked</TooltipContent>
                    </Tooltip>
                  ) : (
                    <Select
                      value={f.type}
                      onValueChange={(v) => onChange(f._key, { type: v as DraftField["type"] })}
                    >
                      <SelectTrigger aria-label="Type" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(TYPE_LABELS).map(([v, n]) => (
                          <SelectItem key={v} value={v}>
                            {n}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </TableCell>
                <TableCell>
                  {canTarget ? (
                    <Select
                      value={f.target_field_id ?? "none"}
                      disabled={!!f.retired_at}
                      onValueChange={(v) => onChange(f._key, { target_field_id: v === "none" ? null : v })}
                    >
                      <SelectTrigger aria-label="Target" className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No target</SelectItem>
                        {planFields.map((p) => (
                          <SelectItem key={p.id} value={p.id!}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-m-on-surface-variant">·</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="sm" onClick={() => onToggleRetire(f._key)}>
                    {f.retired_at ? "Restore" : "Retire"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <button type="button" onClick={onAdd} className="justify-self-start text-label-large text-primary hover:underline">
        + Add a {phase === "plan" ? "plan" : "result"} metric
      </button>
    </div>
  );
}
