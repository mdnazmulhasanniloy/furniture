import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

/**
 * Unsaved-changes guard (A-02). The app uses a non-data router, so `useBlocker` is not available:
 * in-app anchor clicks (sidebar, breadcrumbs) are intercepted in the capture phase, tab close/reload
 * uses `beforeunload`, and explicit buttons call `go()`. Browser back/forward is not intercepted.
 */
export function useUnsavedGuard(dirty: boolean) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search);
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  /** Navigate now when clean, otherwise ask first. */
  const go = useCallback(
    (to: string) => {
      if (dirty) setPending(to);
      else void navigate(to);
    },
    [dirty, navigate],
  );
  const confirm = useCallback(() => {
    const to = pending;
    setPending(null);
    if (to) void navigate(to);
  }, [pending, navigate]);
  const stay = useCallback(() => setPending(null), []);
  return { pending, go, confirm, stay };
}
