import { useCallback, useEffect, useState } from "react";

/** What the person was trying to do when we stopped them. */
export type PendingExit =
  | { kind: "href"; href: string }
  | { kind: "action"; run: () => void };

/**
 * Stops a page with unsaved edits from being left by accident.
 *
 * Two exits have to be covered and they are not the same mechanism:
 *
 *   * Closing the tab, reloading, or following a link out of the app — only
 *     `beforeunload` can interrupt that, and the browser insists on its own
 *     wording, so there is nothing to style.
 *   * Clicking a link inside the app — React Router never touches the browser's
 *     unload event, so `beforeunload` is blind to it. `useBlocker` would be the
 *     tidy answer, but it needs a data router and this app mounts a plain
 *     `BrowserRouter`; migrating the whole router to guard one page is a much
 *     bigger change than catching the click.
 *
 * The click listener runs in the capture phase so it lands before React
 * Router's own handler and can still cancel the navigation. Modified clicks
 * (⌘, ctrl, shift, middle button) are left alone — those open a new tab and
 * this page is not going anywhere.
 */
export function useUnsavedChanges(dirty: boolean) {
  const [pending, setPending] = useState<PendingExit | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Assigning returnValue is what actually triggers the prompt in Chrome
      // and Safari; preventDefault alone is the spec but not the reality.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      // Same page (a hash link, or the breadcrumb for where you already are)
      // isn't leaving, so it isn't worth a dialog.
      if (url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "href", href: url.pathname + url.search });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  /**
   * Wraps an in-page action that would throw work away — switching panes, say,
   * which un-renders the very fields holding the staged edits. Runs straight
   * away when there is nothing to lose.
   */
  const guard = useCallback(
    (run: () => void) => {
      if (!dirty) {
        run();
        return;
      }
      setPending({ kind: "action", run });
    },
    [dirty],
  );

  return { pending, setPending, guard };
}
