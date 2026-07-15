import { useCallback, useEffect, useState } from "react";

/** Which layout the operations overview renders. */
export type DashboardView = "bento" | "board";

// Bumped to :v2 when the default flipped to Board so stale "bento" prefs from
// the old default are dropped and everyone lands on the board.
const STORAGE_KEY = "cc-calc:dashboard-view:v2";

function readInitial(): DashboardView {
  if (typeof window === "undefined") return "board";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "bento" ? "bento" : "board";
  } catch {
    return "board";
  }
}

/**
 * Persisted dashboard view preference (Status board by default, Bento grid as
 * the second view). Mirrors {@link useNavOpen} — localStorage-backed and synced
 * across tabs via the `storage` event.
 */
export function useDashboardView(): [DashboardView, (v: DashboardView) => void] {
  const [view, setViewState] = useState<DashboardView>(readInitial);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, view);
    } catch {
      // ignore
    }
  }, [view]);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        setViewState(e.newValue === "bento" ? "bento" : "board");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setView = useCallback((v: DashboardView) => setViewState(v), []);
  return [view, setView];
}
