"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AppToaster } from "@/components/app-toaster";
import { SessionReset } from "@/components/auth/session-reset";
import { CartSync } from "@/components/cart/cart-sync";
import { FavouritesSync } from "@/components/favourites/favourites-sync";
import { NotificationsSync } from "@/components/notifications/sync";
import { NotificationToaster } from "@/components/notifications/toaster";
import { restoreSession } from "@/lib/auth/session";

export function Providers({ children }: Readonly<{ children: React.ReactNode }>) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  useEffect(() => {
    void restoreSession();
  }, []);
  return <QueryClientProvider client={client}>
      <SessionReset />
      <CartSync />
      <FavouritesSync />
      <NotificationsSync />
      {children}
      <NotificationToaster />
      <AppToaster />
    </QueryClientProvider>;
}
