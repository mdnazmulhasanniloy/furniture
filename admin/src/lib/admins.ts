import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { Customer } from "@/lib/customers";

// api-spec.yaml /admin/admins (ADM-11, backend T-017). The invitee sets their own password on the
// accept-invite screen, so the invite carries no password.
export type AdminUser = Omit<Customer, "role"> & { role: "ADMIN"; invitedById?: string | null };
export type InviteInput = { firstName: string; lastName: string; email: string; preferredLocale: "ar" | "en" };

const KEY = ["admin", "admins"] as const;

export function useAdmins() {
  return useQuery({
    queryKey: [...KEY, "list"],
    queryFn: ({ signal }) => api.get<AdminUser[]>("/admin/admins", { signal }),
  });
}

export function useInviteAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteInput) => api.post<AdminUser>("/admin/admins", input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useResendInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ message: string }>(`/admin/admins/${encodeURIComponent(id)}/resend-invite`, {}),
    // ALREADY_VERIFIED / NOT_FOUND mean the row is stale: refetch either way.
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useBlockAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isBlocked }: { id: string; isBlocked: boolean }) =>
      api.patch<AdminUser>(`/admin/admins/${encodeURIComponent(id)}/block`, { isBlocked }),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
