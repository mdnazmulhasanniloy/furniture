import { create } from "zustand";

// AUTH-01 / AUTH-04: the verify screen needs the email and the registration password
// (resend-otp for VERIFY_EMAIL requires {email, password}, api-spec.yaml) and, after an
// OTP_EXPIRED with no pending row, the register data to re-submit. This lives in memory
// only: never localStorage/sessionStorage/URL. A page reload drops it on purpose.

export type PendingVerification = {
  email: string;
  password: string;
  /** Present when the flow started on the register form (needed to re-register). */
  firstName?: string;
  lastName?: string;
};

type PendingState = {
  pending: PendingVerification | null;
  setPending: (p: PendingVerification) => void;
  clear: () => void;
  /** Email carried from forgot-password to reset-password (in memory only). */
  resetEmail: string | null;
  setResetEmail: (email: string | null) => void;
};

export const usePendingAuth = create<PendingState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
  clear: () => set({ pending: null }),
  resetEmail: null,
  setResetEmail: (resetEmail) => set({ resetEmail }),
}));
