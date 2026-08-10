import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn, toggleInSet } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type MultiSelectOption = { value: string; label: string; count?: number };

export type MultiSelectProps = {
  options: MultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  /** Trigger label when nothing is selected, e.g. "All groups". */
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  className?: string;
};

export function MultiSelect({
  options,
  values,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No results found.",
  className,
}: MultiSelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const selected = React.useMemo(() => new Set(values), [values]);

  const triggerLabel =
    values.length === 0
      ? placeholder
      : values.length === 1
        ? (options.find((o) => o.value === values[0])?.label ?? placeholder)
        : `${values.length} selected`;

  function toggle(value: string) {
    onChange([...toggleInSet(selected, value)]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5">
            {values.length > 1 && (
              <span className="rounded-full bg-m-surface-container px-1.5 text-[10px] tabular-nums text-m-on-surface-variant">
                {values.length}
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[220px] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                // cmdk filters on `value`, so use the human label for search
                // and toggle via closure rather than the callback argument.
                <CommandItem key={opt.value} value={opt.label} onSelect={() => toggle(opt.value)}>
                  <Check
                    className={cn("mr-2 h-4 w-4", selected.has(opt.value) ? "opacity-100" : "opacity-0")}
                  />
                  <span className="flex-1 truncate">{opt.label}</span>
                  {opt.count !== undefined && (
                    <span className="ml-2 text-xs tabular-nums text-muted-foreground">{opt.count}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {values.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    value="__clear__"
                    onSelect={() => onChange([])}
                    className="justify-center text-muted-foreground"
                  >
                    Clear selection
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
