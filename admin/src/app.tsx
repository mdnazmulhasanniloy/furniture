import { useEffect } from "react";
import { Route, Routes } from "react-router";
import { restoreSession } from "@/lib/auth/flows";
import { AcceptInvitePage } from "@/routes/accept-invite-page";
import { LoginPage } from "@/routes/login-page";
import { PlaceholderPage } from "@/routes/placeholder-page";
import { RequireAdmin } from "@/routes/shell";

export function App() {
  // The access token is memory-only: on every page load try the httpOnly refresh cookie once.
  useEffect(() => {
    void restoreSession();
  }, []);
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<AcceptInvitePage />} />
      <Route element={<RequireAdmin />}>
        <Route path="*" element={<PlaceholderPage />} />
      </Route>
    </Routes>
  );
}
