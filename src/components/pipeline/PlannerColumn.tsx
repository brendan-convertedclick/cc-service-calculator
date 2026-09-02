// src/components/pipeline/PlannerColumn.tsx
//
// One month of the planner (/pipeline/:yearId): its theme, its hours total,
// its tasks, and "+ Add a service". A closed month never becomes a drop
// target — moveLegality (via useTaskMove) already refuses it, so the lock
// icon here is affordance only, exactly like the RLS/trigger pair in 0150
// that is the actual gate.

import { useState } from "react";
import { toast } from "sonner";
import { Check, ChevronsUpDown, Lock, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, errorMessage, formatHours } from "@/lib/utils";
import { useServices } from "@/hooks/useServices";
import { useAddServiceToMonth } from "@/hooks/useSchoolYear";
import type { SchoolYearMonth, SchoolYearTask } from "@/hooks/useSchoolYear";
import { TaskCard } from "@/components/pipeline/TaskCard";
import type { TaskMoveApi } from "@/components/pipeline/useTaskMove";

export function PlannerColumn({
  yearId,
  month,
  tasks,
  hours,
  isCurrent,
  move,
  colorById,
}: {
  yearId: string;
  month: SchoolYearMonth;
  /** Already filtered to this month, in ordinal order. */
  tasks: SchoolYearTask[];
  hours: number;
  isCurrent: boolean;
  move: TaskMoveApi;
  colorById?: Map<string, string>;
}) {
  const closed = month.closed_at !== null;
  const verdict = move.pickedId ? move.legalFor(month.month_no) : null;
  const isDropTarget = !!move.pickedId;
  const isRing = move.ringMonth === month.month_no;

  function handleDragOver(e: React.DragEvent) {
    if (!move.pickedId) return;
    e.preventDefault(); // required to allow a drop at all
    e.dataTransfer.dropEffect = move.legalFor(month.month_no).ok ? "move" : "none";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    if (move.pickedId) move.commit(month.month_no);
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        "flex w-[280px] shrink-0 flex-col gap-2 rounded-lg border bg-m-surface-container-low p-2.5",
        isRing ? "ring-2 ring-m-primary" : "border-m-outline-variant",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-label-small text-m-on-surface-variant">M{month.month_no}</p>
          <p className="truncate text-title-small text-m-on-surface" title={month.theme}>
            {month.theme}
          </p>
        </div>
        <div className="flex flex-none items-center gap-1">
          {isCurrent ? <Badge>Now</Badge> : null}
          {closed ? <Lock className="h-3.5 w-3.5 text-m-on-surface-variant" aria-label="Closed" /> : null}
        </div>
      </div>

      <p className="font-mono text-label-small tabular-nums text-m-on-surface-variant">{formatHours(hours)}</p>

      {isDropTarget ? (
        <button
          type="button"
          onClick={() => move.commit(month.month_no)}
          disabled={!verdict?.ok}
          title={verdict && !verdict.ok ? verdict.reason : "Move here"}
          className={cn(
            "rounded-md border border-dashed px-2 py-1.5 text-label-small transition-colors motion-reduce:transition-none",
            verdict?.ok
              ? "border-m-primary bg-m-primary-container text-m-on-primary-container hover:opacity-90"
              : "cursor-not-allowed border-m-outline-variant text-m-on-surface-variant opacity-60",
          )}
        >
          {verdict?.ok ? "Move here" : (verdict?.reason ?? "Can't move here")}
        </button>
      ) : null}

      <div className="flex flex-col gap-2">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} move={move} colorById={colorById} locked={closed || t.state === "done"} />
        ))}
        {tasks.length === 0 ? <p className="py-2 text-center text-label-small text-m-on-surface-variant">Nothing here yet.</p> : null}
      </div>

      <AddServicePopover yearId={yearId} monthNo={month.month_no} disabled={closed} />
    </div>
  );
}

function AddServicePopover({ yearId, monthNo, disabled }: { yearId: string; monthNo: number; disabled: boolean }) {
  const { data: services } = useServices();
  const addService = useAddServiceToMonth();
  const [open, setOpen] = useState(false);

  async function pick(serviceId: string) {
    setOpen(false);
    try {
      await addService.mutateAsync({ yearId, monthNo, serviceId });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || addService.isPending}
          className="justify-between font-normal"
        >
          <span className="flex items-center gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add a service
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search services…" />
          <CommandList>
            <CommandEmpty>No services found.</CommandEmpty>
            <CommandGroup>
              {(services ?? []).map((s) => (
                <CommandItem key={s.id} value={s.name} onSelect={() => void pick(s.id)}>
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
