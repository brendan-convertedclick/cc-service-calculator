import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { X } from "lucide-react";
import type { Database } from "@/types/db";

type Service = Database["public"]["Tables"]["services"]["Row"];
type Dept = Database["public"]["Tables"]["departments"]["Row"];

export type EditorLine = {
  service_id: string;
  qty: number;
  allocation: Record<string, number>;
  hours: Record<string, number>;
};

type Props = {
  line: EditorLine;
  service: Service;
  depts: Dept[];
  onChange: (patch: Partial<EditorLine>) => void;
  onRemove: () => void;
};

export function QuoteLineEditor({ line, service, depts, onChange, onRemove }: Props) {
  const sumPct = Object.values(line.allocation).reduce((a, b) => a + b, 0);
  const sumOutOfTolerance = sumPct < 99.5 || sumPct > 100.5;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-title-small">{service.name}</div>
            <div className="text-label-small text-m-on-surface-variant">{service.code ?? ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`qty-${line.service_id}`}>Qty</Label>
            <Input
              id={`qty-${line.service_id}`}
              type="number"
              step="0.25"
              min="0.25"
              className="w-20"
              value={line.qty}
              onChange={(e) => onChange({ qty: Number(e.target.value) })}
            />
            <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove line">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {depts.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="w-28 text-label-small">{d.name}</span>
              <Input
                type="number"
                step="0.5"
                className="w-20"
                value={line.allocation[d.id] ?? 0}
                onChange={(e) =>
                  onChange({
                    allocation: { ...line.allocation, [d.id]: Number(e.target.value) },
                  })
                }
              />
              <span className="text-label-small text-m-on-surface-variant">%</span>
              <span className="ml-auto text-label-small">{(line.hours[d.id] ?? 0).toFixed(2)}h</span>
            </div>
          ))}
        </div>
        <div
          className={
            sumOutOfTolerance
              ? "text-body-small text-destructive"
              : "text-body-small text-m-on-surface-variant"
          }
        >
          Allocation sum: {sumPct.toFixed(2)}%
        </div>
      </CardContent>
    </Card>
  );
}
