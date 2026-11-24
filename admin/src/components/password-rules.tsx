import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PASSWORD_MIN_LENGTH, passwordRuleStates } from "@/lib/password-policy";
import { cn } from "@/lib/utils";

/**
 * The live password checklist (owner 2026-11-24): the five rules of the one shared policy
 * (src/lib/password-policy.ts, byte-identical to the API's copy), each ticking as soon as it is met.
 * Used wherever an admin password is chosen.
 */
export function PasswordRules({ value, id }: { value: string; id?: string }) {
  const { t } = useTranslation();
  return (
    <div id={id} data-testid="password-rules" className="rounded-md bg-muted p-3 text-xs">
      <p className="font-medium">{t("auth.rules.title")}</p>
      <ul className="mt-1.5 space-y-1">
        {passwordRuleStates(value).map(({ rule, met }) => (
          <li
            key={rule}
            data-rule={rule}
            data-met={met}
            className={cn("flex items-center gap-2", met ? "text-success-foreground" : "text-muted-foreground")}
          >
            {met ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
            <span className="sr-only">{met ? "✓" : "✗"}</span>
            {rule === "length" ? t("auth.rules.length", { n: PASSWORD_MIN_LENGTH }) : t(`auth.rules.${rule}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
