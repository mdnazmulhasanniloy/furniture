import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { ApiError } from "@/lib/api/errors";
import { recheckSession, restoreSession } from "@/lib/auth/flows";
import { authStore } from "@/lib/auth/store";
import { LoginPage } from "@/routes/login-page";
import { RequireAdmin } from "@/routes/shell";

/**
 * QA C4: every page is its own chunk, loaded when its route is first opened. The sign-in page and the
 * shell stay in the entry chunk - they are what a cold visit renders - and the Suspense boundary sits
 * inside the shell, so the sidebar and the top bar never blink while a page arrives.
 */
const AdminsPage = lazy(() => import("@/routes/admins-page").then((m) => ({ default: m.AdminsPage })));
const AcceptInvitePage = lazy(() => import("@/routes/accept-invite-page").then((m) => ({ default: m.AcceptInvitePage })));
const BannerEditorPage = lazy(() => import("@/routes/banner-editor-page").then((m) => ({ default: m.BannerEditorPage })));
const BannersPage = lazy(() => import("@/routes/banners-page").then((m) => ({ default: m.BannersPage })));
const PagesPage = lazy(() => import("@/routes/pages-page").then((m) => ({ default: m.PagesPage })));
const SectionsPage = lazy(() => import("@/routes/sections-page").then((m) => ({ default: m.SectionsPage })));
const LooksPage = lazy(() => import("@/routes/looks-page").then((m) => ({ default: m.LooksPage })));
const CategoriesPage = lazy(() => import("@/routes/categories-page").then((m) => ({ default: m.CategoriesPage })));
const InvoicePage = lazy(() => import("@/routes/invoice-page").then((m) => ({ default: m.InvoicePage })));
const NotificationsPage = lazy(() => import("@/routes/notifications-page").then((m) => ({ default: m.NotificationsPage })));
const OrderDetailPage = lazy(() => import("@/routes/order-detail-page").then((m) => ({ default: m.OrderDetailPage })));
const OrdersPage = lazy(() => import("@/routes/orders-page").then((m) => ({ default: m.OrdersPage })));
const OverviewPage = lazy(() => import("@/routes/overview-page").then((m) => ({ default: m.OverviewPage })));
const ProductEditorPage = lazy(() => import("@/routes/product-editor-page").then((m) => ({ default: m.ProductEditorPage })));
const ProductsPage = lazy(() => import("@/routes/products-page").then((m) => ({ default: m.ProductsPage })));
const CustomerDetailPage = lazy(() => import("@/routes/customer-detail-page").then((m) => ({ default: m.CustomerDetailPage })));
const CustomersPage = lazy(() => import("@/routes/customers-page").then((m) => ({ default: m.CustomersPage })));
const SettingsPage = lazy(() => import("@/routes/settings-page").then((m) => ({ default: m.SettingsPage })));
const PlaceholderPage = lazy(() => import("@/routes/placeholder-page").then((m) => ({ default: m.PlaceholderPage })));

export function App({ queryClient }: { queryClient?: QueryClient } = {}) {
  const [client] = useState(
    () =>
      queryClient ??
      new QueryClient({
        defaultOptions: {
          queries: {
            // QA B5 (2026-11-24): a 4xx is the server's answer, not a hiccup - retrying a 404 only
            // doubles the request and delays the "not found" state. 5xx and network errors still get
            // one retry.
            retry: (failures, error) =>
              !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
              failures < 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  // The access token is memory-only: on every page load try the httpOnly refresh cookie once.
  useEffect(() => {
    void restoreSession();
  }, []);
  /**
   * QA A5 (2026-11-24): a session that ends must leave nothing readable behind. Every path that signs
   * the admin out (the logout button, a customer cookie, a refresh that failed) ends in
   * `authStore.clear()`, so the cache is emptied here - one place, not one per call site.
   */
  useEffect(() => {
    let previous = authStore.get().status;
    const stop = authStore.subscribe(() => {
      const next = authStore.get().status;
      if (previous === "authenticated" && next === "anonymous") client.clear();
      previous = next;
    });
    return () => {
      stop();
    };
  }, [client]);
  /**
   * A page the browser restored from the back/forward cache keeps the whole heap of the old session,
   * so Back could paint the dashboard after a logout elsewhere. Re-check with the server instead.
   */
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      // Only a restore of a document that believes it has a session needs the round trip.
      if (e.persisted && authStore.get().status === "authenticated") void recheckSession();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  return (
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/accept-invite"
          element={
            <Suspense fallback={null}>
              <AcceptInvitePage />
            </Suspense>
          }
        />
        <Route element={<RequireAdmin />}>
          <Route index element={<OverviewPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/new" element={<ProductEditorPage />} />
          <Route path="/products/:id" element={<ProductEditorPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/banners" element={<BannersPage />} />
          <Route path="/banners/new" element={<BannerEditorPage />} />
          <Route path="/banners/:id" element={<BannerEditorPage />} />
          <Route path="/pages" element={<PagesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sections" element={<SectionsPage />} />
          <Route path="/sections/looks" element={<LooksPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderDetailPage />} />
          <Route path="/orders/:id/invoice" element={<InvoicePage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/admins" element={<AdminsPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerDetailPage />} />
          <Route path="*" element={<PlaceholderPage />} />
        </Route>
      </Routes>
    </QueryClientProvider>
  );
}
