import { Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyLines({
  onAiSuggest,
  suggesting,
}: {
  onAiSuggest: () => void;
  suggesting: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-m-outline-variant bg-m-surface-container/40 px-8 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-m-primary-container text-m-on-primary-container">
        <Sparkles className="h-6 w-6" />
      </div>
      <h3 className="text-title-medium">Start with AI suggestions</h3>
      <p className="mt-2 max-w-md text-body-medium text-m-on-surface-variant">
        Let the assistant read the locked scope and propose a matching set of services from your
        catalogue. You can tweak or remove any before finalising.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={onAiSuggest} disabled={suggesting}>
          <Wand2 className="h-4 w-4" />
          {suggesting ? "Thinking…" : "Suggest services from scope"}
        </Button>
        <span className="text-label-small text-m-on-surface-variant">
          or search the catalogue above
        </span>
      </div>
    </div>
  );
}
