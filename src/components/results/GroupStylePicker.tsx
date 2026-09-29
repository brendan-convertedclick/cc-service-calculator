// src/components/results/GroupStylePicker.tsx
//
// A group's badge on the planner and in Year results: its icon, in its colour.
// Clicking it opens the icon and colour choices (0192). Saving goes to the
// results group itself when there is one, so both boards change together, or
// to pipeline_group_styles for a planner-only group. Needs a TooltipProvider
// above it.

import { useState } from "react";
import { toast } from "sonner";
import { cn, errorMessage } from "@/lib/utils";
import { GROUP_COLOURS, type GroupColour } from "@/lib/results-grid";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GROUP_COLOUR_CLASSES } from "@/components/results/groupColours";
import { GROUP_ICONS, groupIcon } from "@/components/results/groupIcons";
import { useSetGroupStyle } from "@/hooks/useResults";

export function GroupStylePicker({
  clientId,
  resultsGroupId,
  name,
  icon,
  colour,
}: {
  clientId: string;
  /** The results group to write to; null for a planner-only group. */
  resultsGroupId: string | null;
  name: string;
  icon: string | null;
  /** Null only for "Not placed yet", which is not stylable. */
  colour: GroupColour | null;
}) {
  const [open, setOpen] = useState(false);
  const setStyle = useSetGroupStyle();
  const Icon = groupIcon(icon, name);
  const tint = colour ? GROUP_COLOUR_CLASSES[colour] : null;

  function save(patch: { icon?: string; colour?: GroupColour }) {
    setStyle.mutate({ clientId, resultsGroupId, name, patch }, { onError: (e) => toast.error(errorMessage(e)) });
  }

  const badge = (
    <span className={cn("grid h-7 w-7 flex-none place-items-center rounded-lg", tint ? tint.text : "text-m-on-surface-variant")}>
      <Icon className="h-5 w-5" />
    </span>
  );

  if (!colour) return badge;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Change the icon and colour of ${name}`}
              className="rounded-lg transition-colors motion-reduce:transition-none hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {badge}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Change icon and colour</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-64 p-3" align="start">
        <p className="mb-2 text-label-small uppercase tracking-wide text-m-on-surface-variant">Icon</p>
        <div className="grid grid-cols-6 gap-1">
          {Object.entries(GROUP_ICONS).map(([key, { label, Icon: I }]) => {
            const selected = groupIcon(icon, name) === I;
            return (
              <button
                key={key}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => save({ icon: key })}
                className={cn(
                  "grid h-8 w-8 place-items-center rounded-md transition-colors motion-reduce:transition-none",
                  "hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected ? cn(tint?.swatch, "text-white hover:opacity-90") : "text-m-on-surface-variant",
                )}
              >
                <I className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        <p className="mb-2 mt-3 text-label-small uppercase tracking-wide text-m-on-surface-variant">Colour</p>
        <div className="flex flex-wrap gap-1">
          {GROUP_COLOURS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              title={c}
              aria-pressed={c === colour}
              onClick={() => save({ colour: c })}
              className={cn(
                "h-6 w-6 rounded-full border-2 transition-transform motion-reduce:transition-none hover:scale-110",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                GROUP_COLOUR_CLASSES[c].swatch,
                c === colour ? "border-m-on-surface" : "border-transparent",
              )}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
