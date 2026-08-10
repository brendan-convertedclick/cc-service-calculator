import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatZar } from "@/lib/utils";
import { ServiceLineRow } from "@/components/scope-receipt/ServiceLineRow";
import { type ReceiptCatalogService, type ReceiptLine } from "@/lib/scope-receipt";
import type { Disposition } from "@/types/sow-placements";
import type { Section, ServiceTableLine } from "@/types/sow-composer";

type ServiceTableSection = Extract<Section, { type: "service_table" }>;

export interface ServiceTableSectionEditorProps {
  section: ServiceTableSection;
  onChange: (props: Partial<ServiceTableSection["props"]>) => void;
  serviceById: Map<string, ReceiptCatalogService>;
  services: ReceiptCatalogService[];
}

function toReceiptLine(l: ServiceTableLine, svc?: ReceiptCatalogService): ReceiptLine {
  return {
    taskRef: l.taskRef,
    name: l.name,
    description: l.description ?? null,
    serviceId: svc?.id ?? null,
    code: svc?.code ?? null,
    unit: svc?.unit_of_sale ?? null,
    qty: l.qty,
    unitCents: l.unitCents,
    lineCents: Math.round(l.qty * l.unitCents),
    confidence: null,
    groundingQuote: null,
    needsReview: false,
    disposition: l.disposition,
    clientReason: null,
    isAssumed: false,
    excluded: false,
  };
}

function newTaskRef(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

export function ServiceTableSectionEditor({
  section,
  onChange,
  serviceById,
  services,
}: ServiceTableSectionEditorProps) {
  const [addOpen, setAddOpen] = useState(false);
  const lines = section.props.lines;

  const patchLine = (taskRef: string, patch: Partial<ServiceTableLine>) =>
    onChange({ lines: lines.map((l) => (l.taskRef === taskRef ? { ...l, ...patch } : l)) });

  const addLine = (svc: ReceiptCatalogService) => {
    const next: ServiceTableLine = {
      taskRef: newTaskRef(),
      name: svc.name,
      serviceId: svc.id,
      qty: 1,
      unitCents: svc.sell_price_cents,
      disposition: "new_billable",
    };
    onChange({ lines: [...lines, next] });
    setAddOpen(false);
  };

  const billableCents = lines
    .filter((l) => l.disposition === "new_billable")
    .reduce((s, l) => s + Math.round(l.qty * l.unitCents), 0);

  return (
    <div className="space-y-2">
      <div className="divide-y divide-m-outline-variant rounded-lg border border-m-outline-variant">
        {lines.length === 0 && (
          <p className="px-4 py-3 text-body-small text-m-on-surface-variant">
            No line items yet.
          </p>
        )}
        {lines.map((l) => (
          <ServiceLineRow
            key={l.taskRef}
            line={toReceiptLine(l, l.serviceId ? serviceById.get(l.serviceId) : undefined)}
            struck={l.disposition === "out_of_scope"}
            onQtyChange={(taskRef, qty) => patchLine(taskRef, { qty })}
            onOverride={(taskRef, disposition: Disposition) => patchLine(taskRef, { disposition })}
          />
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add line
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Add a service…" />
              <CommandList>
                <CommandEmpty>No services.</CommandEmpty>
                <CommandGroup>
                  {services.map((svc) => (
                    <CommandItem key={svc.id} value={`${svc.code ?? ""} ${svc.name}`} onSelect={() => addLine(svc)}>
                      <span className="flex-1 truncate">{svc.name}</span>
                      <span className="ml-2 text-label-small font-mono tabular-nums text-m-on-surface-variant">
                        {formatZar(svc.sell_price_cents)}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <span
          data-testid={`editor-subtotal-${section.id}`}
          data-cents={billableCents}
          className="text-label-medium tabular-nums text-m-on-surface-variant"
        >
          Billable <span className="font-mono tabular-nums">{formatZar(billableCents)}</span>
        </span>
      </div>
    </div>
  );
}
