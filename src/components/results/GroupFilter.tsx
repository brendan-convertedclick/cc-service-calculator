// src/components/results/GroupFilter.tsx
//
// Multi-select of a client's results groups, with a "Show all" shortcut.
// Ticking only one group hides every row not in it.

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function GroupFilter({
  groups,
  selected,
  onChange,
}: {
  groups: { id: string; name: string }[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allIds = groups.map((g) => g.id);
  const label =
    selected.size === groups.length
      ? "All groups"
      : selected.size === 1
        ? (groups.find((g) => selected.has(g.id))?.name ?? "1 group")
        : selected.size === 0
          ? "No groups"
          : `${selected.size} groups`;

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    onChange(next);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full font-normal">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <button
          type="button"
          onClick={() => onChange(new Set(allIds))}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-label-medium text-m-primary hover:bg-m-surface-container-low"
        >
          <Check className="h-3.5 w-3.5" />
          Show all
        </button>
        <div className="grid gap-0.5">
          {groups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-label-large hover:bg-m-surface-container-low"
            >
              <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
              {g.name}
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
