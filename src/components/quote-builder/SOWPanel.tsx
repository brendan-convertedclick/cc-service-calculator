import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SOWPreview } from "@/components/SOWPreview";

export function SOWPanel({
  html,
  onChange,
  onDraft,
  drafting,
  canDraft,
}: {
  html: string;
  onChange: (html: string) => void;
  onDraft: () => void;
  drafting: boolean;
  canDraft: boolean;
}) {
  if (!html) {
    return (
      <div className="flex flex-col gap-3">
        <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
          Statement of work
        </div>
        <div className="flex items-center gap-3 rounded-md border border-m-outline-variant bg-m-surface p-3">
          <FileText className="h-5 w-5 shrink-0 text-m-on-surface-variant" />
          <div className="min-w-0 flex-1">
            <div className="text-body-small text-m-on-surface">No SOW drafted yet</div>
            <div className="text-label-small text-m-on-surface-variant">
              {canDraft
                ? "Draft once line items are settled"
                : "Add a service to enable"}
            </div>
          </div>
          <Button size="sm" onClick={onDraft} disabled={!canDraft || drafting}>
            {drafting ? "Drafting…" : "Draft SOW"}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-label-small uppercase tracking-wider text-m-on-surface-variant">
          Statement of work
        </div>
        <Button variant="secondary" size="sm" onClick={onDraft} disabled={drafting}>
          {drafting ? "Redrafting…" : "Redraft"}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <SOWPreview html={html} onChange={onChange} />
      </div>
    </div>
  );
}
