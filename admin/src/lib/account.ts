import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { api, primeCsrf } from "@/lib/api/client";
import { authStore, type AuthSession, type AuthUser } from "@/lib/auth/store";
import { isStrongPassword } from "@/lib/password-policy";

// T-109 (QA C5). The signed-in admin's own account:
//  - `POST /auth/change-password` (api-spec T-108): current password required, the one shared policy
//    on the new one, every other session revoked; the response keeps THIS session alive, so its token
//    and cookie replace what we hold.
//  - `PATCH /me` for the name. That route is behind `requireAuth` with no role check, so it needs no
//    admin endpoint of its own; the email is not changeable anywhere, by design.

/** Message values are locale keys, translated by the dialog. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "auth.required"),
    newPassword: z.string().min(1, "auth.required").refine(isStrongPassword, "auth.passwordWeak"),
    confirmPassword: z.string().min(1, "auth.required"),
  })
  .superRefine((v, ctx) => {
    if (v.newPassword && v.confirmPassword && v.newPassword !== v.confirmPassword) {
      ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "account.mismatch" });
    }
    // Refused by the API too (422 SAME_PASSWORD); caught here so the attempt is never spent.
    if (v.currentPassword && v.newPassword && v.currentPassword === v.newPassword) {
      ctx.addIssue({ code: "custom", path: ["newPassword"], message: "account.sameAsCurrent" });
    }
  });
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export const profileSchema = z.object({
  firstName: z.string().trim().min(1, "required").max(40, "tooLong"),
  lastName: z.string().trim().min(1, "required").max(40, "tooLong"),
});
export type ProfileValues = z.infer<typeof profileSchema>;

export function useChangePassword() {
  return useMutation({
    mutationFn: (v: ChangePasswordValues) =>
      api.post<AuthSession>("/auth/change-password", {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      }),
    onSuccess: async (session) => {
      // Every other session is gone and this one was rotated: hold the new token, then re-prime the
      // CSRF token, which is bound to the (new) session family.
      authStore.setSession(session);
      await primeCsrf();
    },
  });
}

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (v: ProfileValues) =>
      api.patch<AuthUser>("/me", { firstName: v.firstName.trim(), lastName: v.lastName.trim() }),
    onSuccess: (user) => authStore.setUser(user),
  });
}
