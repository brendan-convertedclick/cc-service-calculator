import type { ReactNode } from "react";
import { useSettings } from "@/hooks/useSettings";

type FlagKey = "xero_enabled" | "clickup_enabled" | "anthropic_enabled";

type Props = {
  flag: FlagKey;
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Hides children when the named settings flag is false (or settings are still loading).
 * Xero controls in Phase 1 use fallback=null; they are hidden, not disabled (per spec §7.6).
 */
export function FeatureFlagGate({ flag, children, fallback = null }: Props) {
  const { data } = useSettings();
  if (!data?.[flag]) return <>{fallback}</>;
  return <>{children}</>;
}
