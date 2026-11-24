import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Route, Routes } from "react-router";
import { restoreSession } from "@/lib/auth/flows";
import { AdminsPage } from "@/routes/admins-page";
import { AcceptInvitePage } from "@/routes/accept-invite-page";
import { BannerEditorPage } from "@/routes/banner-editor-page";
import { BannersPage } from "@/routes/banners-page";
import { PagesPage } from "@/routes/pages-page";
import { SectionsPage } from "@/routes/sections-page";
import { CategoriesPage } from "@/routes/categories-page";
import { InvoicePage } from "@/routes/invoice-page";
import { LoginPage } from "@/routes/login-page";
import { NotificationsPage } from "@/routes/notifications-page";
import { OrderDetailPage } from "@/routes/order-detail-page";
import { OrdersPage } from "@/routes/orders-page";
import { OverviewPage } from "@/routes/overview-page";
import { ProductEditorPage } from "@/routes/product-editor-page";
import { ProductsPage } from "@/routes/products-page";
import { CustomerDetailPage } from "@/routes/customer-detail-page";
import { CustomersPage } from "@/routes/customers-page";
import { SettingsPage } from "@/routes/settings-page";
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
