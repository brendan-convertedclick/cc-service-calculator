import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import type { ReceiptCatalogService } from "@/lib/scope-receipt";
import type { Section, SectionType, SowBody } from "@/types/sow-composer";
import { useSaveSectionToLibrary } from "@/hooks/useSowComposer";
import { SectionCard } from "./SectionCard";

export interface SectionListProps {
  body: SowBody;
  onChange: (body: SowBody) => void;
  serviceById: Map<string, ReceiptCatalogService>;
  services: ReceiptCatalogService[];
  variableKeys: string[];
}

function newId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function makeSection(type: SectionType, ordinal: number): Section {
  const id = newId();
  switch (type) {
    case "prose":
      return { id, type, ordinal, props: { markdown: "" } };
    case "service_table":
      return { id, type, ordinal, props: { lines: [], showCostColumn: true } };
    case "clause":
      return { id, type, ordinal, props: { clauseKey: "" } };
    case "list":
      return { id, type, ordinal, props: { variant: "inclusions", items: [] } };
    case "signature":
      return { id, type, ordinal, props: {} };
  }
}

const ADDABLE: { type: SectionType; label: string }[] = [
  { type: "prose", label: "Prose" },
  { type: "service_table", label: "Service table" },
  { type: "list", label: "Inclusions / Exclusions" },
  { type: "clause", label: "Clause" },
  { type: "signature", label: "Signature" },
];

export function SectionList({
  body,
  onChange,
  serviceById,
  services,
  variableKeys,
}: SectionListProps) {
  const saveToLibrary = useSaveSectionToLibrary();
  const [addOpen, setAddOpen] = useState(false);
  const ordered = [...body].sort((a, b) => a.ordinal - b.ordinal);

  const replace = (id: string, props: Record<string, unknown>) =>
    onChange(
      body.map((s) => (s.id === id ? ({ ...s, props: { ...s.props, ...props } } as Section) : s)),
    );

  const move = (id: string, dir: -1 | 1) => {
    const idx = ordered.findIndex((s) => s.id === id);
    const swapWith = idx + dir;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    const next = [...ordered];
    const a = next[idx];
    const b = next[swapWith];
    const aOrd = a.ordinal;
    a.ordinal = b.ordinal;
    b.ordinal = aOrd;
    onChange(next);
  };

  const remove = (id: string) => onChange(body.filter((s) => s.id !== id));

  const add = (type: SectionType) => {
    const maxOrd = body.reduce((m, s) => Math.max(m, s.ordinal), -1);
    onChange([...body, makeSection(type, maxOrd + 1)]);
  };

  const onSaveToLibrary = (section: Section) => {
    saveToLibrary.mutate(
      { name: section.props.heading || `${section.type} section`, type: section.type, node: section },
      {
        onSuccess: () => toast.success("Saved to library"),
        onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save"),
      },
    );
  };

  return (
    <div className="space-y-3">
      {ordered.map((section, i) => (
        <SectionCard
          key={section.id}
          section={section}
          isFirst={i === 0}
          isLast={i === ordered.length - 1}
          onChangeProps={(props) => replace(section.id, props)}
          onMove={(dir) => move(section.id, dir)}
          onRemove={() => remove(section.id)}
          onSaveToLibrary={() => onSaveToLibrary(section)}
          serviceById={serviceById}
          services={services}
          variableKeys={variableKeys}
        />
      ))}

      <Popover open={addOpen} onOpenChange={setAddOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full gap-1" data-testid="add-section">
            <Plus className="h-4 w-4" />
            Add section
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          {ADDABLE.map((a) => (
            <button
              key={a.type}
              type="button"
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-body-medium text-m-on-surface hover:bg-m-surface-container"
              onClick={() => {
                add(a.type);
                setAddOpen(false);
              }}
            >
              {a.label}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
