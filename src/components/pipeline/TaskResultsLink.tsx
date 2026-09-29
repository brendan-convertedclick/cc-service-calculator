// src/components/pipeline/TaskResultsLink.tsx
//
// "Show in Year results" control, shared by TaskCard (the planner) and
// SchoolDrawer's TaskGroup rows. Unlinked: a popover picker of the client's
// results rows, grouped. Linked: the row's name + Unlink. See
// docs/superpowers/specs/2026-09-28-school-year-results-pipeline-link.md.
//
// On TaskCard this renders as a SIBLING of the card's role="button" element,
// never nested inside it (review finding: a link/button inside another
// role="button" is invalid ARIA nesting and unreachable by a screen reader
// operating the outer button) — TaskCard wraps drag/pick-up onto its own
// element and this component owns its own interactive surface. Every event
// here still stops propagation, since TaskCard's draggable div and its
// onClick/onKeyDown listeners are further up the same DOM subtree either way.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BarChart3, Check, Link2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, errorMessage } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLinkTask, useResultsPickerGroups, useUnlinkTask, type TaskLink } from "@/hooks/useResults";

function stop(e: React.SyntheticEvent) {
  e.stopPropagation();
}

export function TaskResultsLink({
  clientId,
  yearId,
  taskId,
  link,
  compact = false,
}: {
  clientId: string;
  yearId: string;
  taskId: string;
  link: TaskLink | undefined;
  /** The planner card's icon form: one chart button, lit when linked, that
   *  opens the same picker. Needs a TooltipProvider above it. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { data: groups, isPending: groupsPending, isError: groupsError } = useResultsPickerGroups(open ? clientId : undefined);
  const linkTask = useLinkTask();
  const unlinkTask = useUnlinkTask();

  // Focus follow-through (review finding): once a link/unlink actually lands
  // (the mutation's onSuccess resolves only after useTaskLinks has refetched
  // — see useLinkTask/useUnlinkTask), the control this renders swaps branch
  // entirely (Unlink button <-> the picker trigger). A mouse user sees the
  // swap; a keyboard/screen-reader user needs focus carried to whichever
  // control exists now, or it silently lands back on <body>.
  const focusPendingRef = useRef(false);
  const unlinkButtonRef = useRef<HTMLButtonElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusPendingRef.current) return;
    focusPendingRef.current = false;
    if (link) unlinkButtonRef.current?.focus();
    else triggerButtonRef.current?.focus();
  }, [link]);

  function pick(rowId: string) {
    setOpen(false);
    linkTask.mutate(
      { yearId, clientId, taskId, rowId },
      {
        onSuccess: () => {
          focusPendingRef.current = true;
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  function unlink() {
    unlinkTask.mutate(
      { yearId, clientId, taskId },
      {
        onSuccess: () => {
          focusPendingRef.current = true;
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  }

  const picker = groupsPending ? (
      <p className="flex items-center gap-1.5 p-3 text-label-small text-m-on-surface-variant">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading channels…
      </p>
    ) : groupsError ? (
      <p className="p-3 text-label-small text-destructive">Could not load Year results rows.</p>
    ) : !groups || groups.length === 0 ? (
      <p className="p-3 text-label-small text-m-on-surface-variant">
        No Year results channels yet.{" "}
        <Link to={`/results/${clientId}`} className="text-m-primary hover:underline">
          Set them up
        </Link>
        .
      </p>
    ) : (
      <Command>
        <CommandInput placeholder="Search channels…" />
        <CommandList>
          <CommandEmpty>No channels found.</CommandEmpty>
          {groups.map((g) => (
            <CommandGroup key={g.id} heading={g.name}>
              {g.rows.map((r) => (
                <CommandItem key={r.id} value={`${g.name} ${r.name}`} onSelect={() => pick(r.id)}>
                  <Check className="mr-2 h-4 w-4 opacity-0" />
                  {r.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    );

  if (compact) {
    const tip = link ? `In Year results: ${link.groupName} · ${link.rowName}` : "Not in Year results. Click to add it.";
    return (
      <div onClick={stop} onMouseDown={stop} onKeyDown={stop} draggable={false} className="flex">
        <Popover open={open} onOpenChange={setOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={tip}
                  className={cn(
                    "grid h-6 w-6 place-items-center rounded-md transition-colors motion-reduce:transition-none",
                    "hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    link ? "text-m-primary" : "text-m-on-surface-variant/50 hover:text-m-on-surface",
                  )}
                >
                  <BarChart3 className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{tip}</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-64 p-0" align="start">
            {link ? (
              <div className="flex items-center gap-1 border-b border-m-outline-variant px-3 py-2 text-label-small">
                <span className="min-w-0 flex-1 truncate">
                  In Year results: <b className="font-semibold">{link.rowName}</b>
                </span>
                <button
                  type="button"
                  onClick={unlink}
                  disabled={unlinkTask.isPending}
                  className="flex-none rounded px-1.5 py-0.5 text-m-primary hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Remove
                </button>
              </div>
            ) : null}
            {picker}
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  if (link) {
    return (
      <div
        onClick={stop}
        onMouseDown={stop}
        onKeyDown={stop}
        draggable={false}
        className="flex min-w-0 items-center gap-1 text-label-small text-m-on-surface-variant"
      >
        <Link2 className="h-3 w-3 flex-none" aria-hidden />
        <span className="min-w-0 flex-1 truncate">In Year results: {link.rowName}</span>
        <button
          ref={unlinkButtonRef}
          type="button"
          onClick={unlink}
          disabled={unlinkTask.isPending}
          className="flex-none rounded p-0.5 hover:bg-m-surface-container-high focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Unlink from ${link.rowName}`}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div onClick={stop} onMouseDown={stop} onKeyDown={stop} draggable={false}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerButtonRef}
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-label-small font-normal text-m-on-surface-variant"
          >
            <Link2 className="h-3 w-3" /> Show in Year results
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          {picker}
        </PopoverContent>
      </Popover>
    </div>
  );
}
