"use client";

import { useEffect } from "react";

import { useAuthStore } from "@/lib/auth/store";
import { GUEST_KEY } from "@/lib/cart/guest";
import { hydrateGuest, resetToGuest, syncAfterLogin } from "@/lib/cart/store";

/** Mounted once in Providers: loads the guest cart, merges it on login, resets on logout. */
export function CartSync() {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    hydrateGuest();
    const onStorage = (e: StorageEvent) => {
      if (e.key === GUEST_KEY || e.key === null) hydrateGuest();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && role === "CUSTOMER") void syncAfterLogin();
    else if (status === "anonymous") resetToGuest();
  }, [status, role]);

  return null;
}
