import { ArrowDown, ArrowUp, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ReceiptCatalogService } from "@/lib/scope-receipt";
import type { Section } from "@/types/sow-composer";
import { ProseSectionEditor } from "./ProseSectionEditor";
import { ServiceTableSectionEditor } from "./ServiceTableSectionEditor";
import { ListSectionEditor } from "./ListSectionEditor";

const TYPE_LABEL: Record<Section["type"], string> = {
  prose: "Prose",
  service_table: "Service table",
  clause: "Clause",
  list: "List",
  signature: "Signature",
};

export interface SectionCardProps {
  section: Section;
  isFirst: boolean;
  isLast: boolean;
  onChangeProps: (props: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onSaveToLibrary: () => void;
  serviceById: Map<string, ReceiptCatalogService>;
  services: ReceiptCatalogService[];
  variableKeys: string[];
}

export function SectionCard({
  section,
  isFirst,
  isLast,
  onChangeProps,
  onMove,
  onRemove,
  onSaveToLibrary,
  serviceById,
  services,
  variableKeys,
}: SectionCardProps) {
  return (
    <Card data-testid={`section-${section.id}`} className="border-m-outline-variant">
      <div className="flex items-center justify-between border-b border-m-outline-variant px-3 py-1.5">
        <span className="text-label-medium font-medium text-m-on-surface-variant">
          {TYPE_LABEL[section.type]}
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Move section up"
            disabled={isFirst}
            onClick={() => onMove(-1)}
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Move section down"
            disabled={isLast}
            onClick={() => onMove(1)}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Save section to library"
            onClick={onSaveToLibrary}
          >
            <Star className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-m-error"
            aria-label="Remove section"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <CardContent className="p-3">
        {section.type === "prose" && (
          <ProseSectionEditor section={section} onChange={onChangeProps} variableKeys={variableKeys} />
        )}
        {section.type === "service_table" && (
          <ServiceTableSectionEditor
            section={section}
            onChange={onChangeProps}
            serviceById={serviceById}
            services={services}
          />
        )}
        {section.type === "list" && <ListSectionEditor section={section} onChange={onChangeProps} />}
        {section.type === "clause" && (
          <p className="text-body-small text-m-on-surface-variant">
            Clause <span className="font-mono">{section.props.clauseKey || "(unset)"}</span> —
            inherited via resolve_sow_clause (phase 2).
          </p>
        )}
        {section.type === "signature" && (
          <p className="text-body-small text-m-on-surface-variant">Signature block.</p>
        )}
      </CardContent>
    </Card>
  );
}
