import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * The "what am I supposed to put here?" marker that sits beside a field label.
 *
 * A real <button> rather than a bare icon: Radix opens the tooltip on focus as
 * well as hover, so the explanation is reachable by keyboard and read out by a
 * screen reader instead of being mouse-only. type="button" because these live
 * inside forms and must never submit one.
 */
export function FieldHint({ label, children }: { label: string; children: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`What to enter for ${label}`}
            className="inline-grid h-4 w-4 flex-none place-items-center rounded-full text-m-on-surface-variant hover:text-m-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-64 text-pretty">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default FieldHint;
