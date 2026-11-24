"use client";

import { useCallback, useEffect, useState } from "react";

export const RESEND_SECONDS = 60;

/** Seconds left, ticking once a second; `restart(n)` resets it (AUTH-04, 60 s resend). */
export function useCountdown(initial: number) {
  const [seconds, setSeconds] = useState(initial);
  useEffect(() => {
    if (seconds <= 0) return;
    const id = setTimeout(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [seconds]);
  const restart = useCallback((n: number) => setSeconds(n), []);
  return [seconds, restart] as const;
}
