import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { restoreSession } from "@/lib/auth/flows";
import { AcceptInvitePage } from "@/routes/accept-invite-page";
import { CategoriesPage } from "@/routes/categories-page";
import { LoginPage } from "@/routes/login-page";
import { OverviewPage } from "@/routes/overview-page";
import { PlaceholderPage } from "@/routes/placeholder-page";
import { RequireAdmin } from "@/routes/shell";

export function App({ queryClient }: { queryClient?: QueryClient } = {}) {
  const [client] = useState(
    () =>
      queryClient ??
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  // The access token is memory-only: on every page load try the httpOnly refresh cookie once.
  useEffect(() => {
    void restoreSession();
  }, []);
  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
        <Route element={<RequireAdmin />}>
          <Route index element={<OverviewPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
