import { AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ResolvedToken } from "@/lib/sow-doc";

const SOURCE_LABEL: Record<string, string> = {
  document: "Document override",
  client: "Client override",
  record: "From record",
  registry: "Registry default",
  computed: "Computed",
};

/**
 * Inline merge-field chip. A known variable renders its resolved value with a
 * tooltip naming the layer it resolved from; an unknown variable renders a red
 * warning chip so a blank/wrong token can never silently ship to a client.
 */
export function MergeFieldChip({ token }: { token: ResolvedToken }) {
  if (!token.known) {
    return (
      <span
        data-testid={`unknown-var-${token.key}`}
        className="inline-flex items-center gap-1 rounded bg-m-error-container px-1.5 py-0.5 text-label-small font-medium text-m-on-error-container"
        title={`Unknown variable: ${token.key}`}
      >
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        unknown variable: {token.key}
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid={`chip-${token.key}`}
            className={cn(
              "inline-flex items-center rounded bg-m-primary-container px-1.5 py-0.5 text-label-small font-medium text-m-on-primary-container",
            )}
          >
            {token.formatted || "—"}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span className="font-mono">{token.key}</span>
          {" · "}
          {SOURCE_LABEL[token.source ?? "registry"]}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
