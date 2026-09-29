// src/hooks/useGridExpansion.ts
//
// Open/closed state for the planner (PipelineGrid) and Year results
// (ResultsGrid), shared so the two boards behave the same.
//
// The default is groups open and every row closed: the board opens as one
// line of monthly counts per row, and you open the rows you want to work in.

import { useState } from "react";

export function useGridExpansion() {
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const isGroupOpen = (id: string) => !closedGroups.has(id);
  const isRowOpen = (id: string) => openRows.has(id);

  function toggleGroup(id: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleRow(id: string) {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** All of a group's rows open (ignoring rows with nothing to show). */
  const rowsAllOpen = (rowIds: string[]) => rowIds.length > 0 && rowIds.every((id) => openRows.has(id));

  /** Opens every row (and the group itself), or closes them all. */
  function toggleGroupRows(groupId: string, rowIds: string[]) {
    const open = !rowsAllOpen(rowIds);
    setOpenRows((prev) => {
      const next = new Set(prev);
      for (const id of rowIds) {
        if (open) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    if (open) setClosedGroups((prev) => new Set([...prev].filter((g) => g !== groupId)));
  }

  const anyGroupOpen = (groupIds: string[]) => groupIds.some((id) => !closedGroups.has(id));

  /** Closes every group, or opens them all. Opening leaves rows as they were, which by default is closed. */
  function toggleAllGroups(groupIds: string[]) {
    setClosedGroups(anyGroupOpen(groupIds) ? new Set(groupIds) : new Set());
  }

  return { isGroupOpen, isRowOpen, toggleGroup, toggleRow, rowsAllOpen, toggleGroupRows, anyGroupOpen, toggleAllGroups };
}
