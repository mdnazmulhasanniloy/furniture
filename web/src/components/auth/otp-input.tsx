"use client";

import { motion } from "framer-motion";
import { useRef } from "react";

import { digitsOnly } from "@/lib/auth/validation";
import { useMotionPrefs } from "@/lib/use-motion-prefs";
import { cn } from "@/lib/utils";

export const OTP_LENGTH = 6;

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** Accessible name of the digit box at 1-based position n. */
  label: (n: number) => string;
  groupLabel: string;
};

/**
 * Six separate digit inputs (W-06) with paste support. Digits always run left-to-right,
 * also in RTL (a code is a number, not prose), hence dir="ltr" on the group.
 */
export function OtpInput({ value, onChange, disabled, invalid, label, groupLabel }: Props) {
  const { reduced } = useMotionPrefs();
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: OTP_LENGTH }, (_, i) => value[i] ?? "");

  const focus = (i: number) => refs.current[Math.min(Math.max(i, 0), OTP_LENGTH - 1)]?.focus();

  return (
    <motion.div
      role="group"
      aria-label={groupLabel}
      dir="ltr"
      className="flex justify-center gap-2"
      data-testid="otp-group"
      // A wrong code shakes the group once (decorative; skipped under reduced motion).
      animate={invalid && !reduced ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
    >
      {digits.map((d, i) => (
        <motion.input
          key={i}
          data-filled={d ? "true" : "false"}
          // A digit pops in when typed (decorative; skipped under reduced motion).
          animate={d && !reduced ? { scale: [1, 1.12, 1] } : { scale: 1 }}
          transition={{ duration: 0.2 }}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={label(i + 1)}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          data-testid={`otp-${i}`}
          className={cn(
            "h-12 w-10 rounded-md border border-input bg-card transition-colors data-[filled=true]:border-primary text-center text-lg font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 sm:w-12",
            invalid && "border-destructive",
          )}
          onChange={(e) => {
            const clean = digitsOnly(e.target.value);
            if (!clean) {
              if (e.target.value === "") onChange(value.slice(0, i) + value.slice(i + 1));
              return;
            }
            // Keep the last typed digit when a box already held one.
            const ch = clean.slice(-1);
            onChange((value.slice(0, i) + ch + value.slice(i + 1)).slice(0, OTP_LENGTH));
            focus(i + 1);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !d) {
              e.preventDefault();
              onChange(value.slice(0, Math.max(0, i - 1)) + value.slice(i));
              focus(i - 1);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              focus(i - 1);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              focus(i + 1);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const clean = digitsOnly(e.clipboardData.getData("text"));
            if (!clean) return;
            const next = clean.slice(0, OTP_LENGTH);
            onChange(next);
            focus(next.length >= OTP_LENGTH ? OTP_LENGTH - 1 : next.length);
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
      ))}
    </motion.div>
  );
}
