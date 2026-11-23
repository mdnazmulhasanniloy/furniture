"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { CartSync } from "@/components/cart/cart-sync";
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
      <CartSync />
      {children}
    </QueryClientProvider>;
}
