"use client";

import { useEffect } from "react";

import { useAuthStore } from "@/lib/auth/store";
import { startLiveNotifications } from "@/lib/notifications/socket";
import { resetNotifications } from "@/lib/notifications/store";

/** Mounted once in Providers: socket + bell state for logged-in customers only (admin has its own app). */
export function NotificationsSync() {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    if (status !== "authenticated" || role !== "CUSTOMER") return;
    const stop = startLiveNotifications();
    return () => {
      stop();
      resetNotifications();
    };
  }, [status, userId, role]);

  return null;
}
