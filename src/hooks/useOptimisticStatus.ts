import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";

type Row = { id: string; status: string };

/**
 * Decide a request in one click: the row takes its new status on screen at
 * once and the write runs behind it, instead of the page sitting on a ClickUp
 * round trip. Used by /approvals and /escalations.
 *
 * Pass every load through `overlay`: rows whose write has not come back yet
 * keep the status already shown, so a reload landing while another decision
 * is still in flight cannot put that row back.
 */
export function useOptimisticStatus() {
  const inFlight = useRef(new Map<string, string>());

  const overlay = useCallback(
    <T extends Row>(rows: T[]): T[] =>
      rows.map((r) => (inFlight.current.has(r.id) ? ({ ...r, status: inFlight.current.get(r.id) } as T) : r)),
    [],
  );

  /** `write` resolves to the success toast. If it throws, the reload puts the
   *  row back and `undo` restores whatever the approver had typed. */
  const decide = useCallback(
    <T extends Row>(
      setRows: Dispatch<SetStateAction<T[] | null>>,
      reload: () => Promise<void>,
      id: string,
      status: T["status"],
      write: () => Promise<string>,
      undo?: () => void,
    ) => {
      inFlight.current.set(id, status);
      setRows((rows) => rows && overlay(rows));
      write()
        .then(
          (msg) => toast.success(msg),
          (e) => {
            toast.error(errorMessage(e));
            undo?.();
          },
        )
        .finally(() => {
          inFlight.current.delete(id);
          void reload();
        });
    },
    [overlay],
  );

  return { overlay, decide };
}
