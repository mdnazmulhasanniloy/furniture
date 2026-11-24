"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { recheckSession } from "@/lib/auth/session";
import { useAuthStore } from "@/lib/auth/store";

/**
 * QA A5 (2026-11-24). Mounted once in Providers: when a session ends, nothing of it may stay
 * readable. The cart, favourites and notification stores already reset on `anonymous` (their own sync
 * components); this drops what is left - any cached query data, and the Next router cache, which can
 * otherwise paint a previously rendered account page when the customer presses Back. The account shell
 * then re-checks and sends the guest to /login.
 *
 * It also re-checks with the server when the browser restores this document from the back/forward
 * cache, where the whole heap of the old session comes back as it was.
 */
export function SessionReset() {
  const status = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();
  const router = useRouter();
  const previous = useRef(status);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    if (status !== "anonymous" || was !== "authenticated") return;
    queryClient.clear();
    router.refresh();
  }, [status, queryClient, router]);

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      // Only a restore of a document that believes it has a session needs the round trip.
      if (e.persisted && useAuthStore.getState().status === "authenticated") void recheckSession();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  return null;
}
