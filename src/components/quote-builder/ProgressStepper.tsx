import { Check } from "lucide-react";

export const STEPS = [
  { key: "scope", label: "Scope" },
  { key: "build", label: "Build" },
  { key: "quote", label: "Quote" },
  { key: "send", label: "Send" },
] as const;

export function ProgressStepper({ current }: { current: "scope" | "build" | "quote" | "send" }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex items-center gap-2 text-label-small">
      {STEPS.map((step, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full border " +
                (done
                  ? "border-m-primary bg-m-primary text-m-on-primary"
                  : active
                  ? "border-m-primary text-m-primary"
                  : "border-m-outline-variant text-m-on-surface-variant")
              }
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={
                active
                  ? "text-m-on-surface"
                  : done
                  ? "text-m-on-surface-variant"
                  : "text-m-on-surface-variant/70"
              }
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="mx-1 h-px w-8 bg-m-outline-variant" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
