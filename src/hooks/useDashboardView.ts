import { useCallback, useEffect, useState } from "react";

/** Which layout the operations overview renders. */
export type DashboardView = "bento" | "board";

const STORAGE_KEY = "cc-calc:dashboard-view";

function readInitial(): DashboardView {
  if (typeof window === "undefined") return "bento";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "board" ? "board" : "bento";
  } catch {
    return "bento";
  }
}

/**
 * Persisted dashboard view preference (Bento grid by default, Status board as
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
        setViewState(e.newValue === "board" ? "board" : "bento");
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const setView = useCallback((v: DashboardView) => setViewState(v), []);
  return [view, setView];
}
