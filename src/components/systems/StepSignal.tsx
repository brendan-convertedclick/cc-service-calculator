// Verb picker + signal/noise interrogation for one step — ported from the
// procedure-builder prototype. Used by the Steps pane (full question grid) and
// the canvas Block inspector (verb + verdict only; the 186px rail can't hold
// the grid).
import { cn } from "@/lib/utils";
import type { Database } from "@/types/db";

type Step = Database["public"]["Tables"]["process_steps"]["Row"];
type StepUpdate = Database["public"]["Tables"]["process_steps"]["Update"];

export type VerbKind = "production" | "handoff" | "check" | "admin";

// The GROUP a verb sits in is the point, not the word: a "handoff" verb marks a
// step boundary, and only a "check" verb makes question 3 ("is this the only
// place that catches this risk?") mean anything — so we never have to ask
// "is this a check?" separately.
export const VERB_GROUPS: { label: string; kind: VerbKind; verbs: string[] }[] = [
  {
    label: "Produces something",
    kind: "production",
    verbs: ["Create", "Draft", "Write", "Design", "Build", "Develop", "Edit", "Plan", "Research"],
  },
  {
    label: "Hands off to someone else",
    kind: "handoff",
    verbs: ["Brief", "Send", "Submit", "Approve", "Sign off", "Review", "Escalate", "Present"],
  },
  { label: "Checks or verifies", kind: "check", verbs: ["Check", "Verify", "QA", "Audit", "Proofread", "Test"] },
  {
    label: "Admin / moves something",
    kind: "admin",
    verbs: ["Save", "File", "Upload", "Log", "Update", "Notify", "Schedule"],
  },
];

export const VERB_KIND: Record<string, VerbKind> = Object.fromEntries(
  VERB_GROUPS.flatMap((g) => g.verbs.map((v) => [v, g.kind] as const))
);

const QUESTIONS = [
  { field: "signal_q1", text: "Would the client notice if this step vanished?" },
  { field: "signal_q2", text: "Does the step produce or transform something?" },
  { field: "signal_q3", text: "Is this the only place that catches this specific risk?", checkOnly: true },
  { field: "signal_q4", text: "Does the step exist only to fix a mistake made in an earlier step?" },
  { field: "signal_q5", text: "Does skipping this cause real costs or failure?" },
] as const satisfies readonly { field: keyof Step; text: string; checkOnly?: boolean }[];

export type Verdict = "keep" | "cut" | "pending" | "review";

export const VERDICT_LABEL: Record<Verdict, string> = {
  keep: "Keep",
  cut: "Cut candidate",
  pending: "Not evaluated yet",
  review: "Needs a look",
};

// One clear "Yes" to any decisive question is enough to keep a step — you don't
// have to answer the rest. A step only becomes a cut candidate once every
// decisive question has been explicitly answered "No".
//
// q3 is decisive ONLY for check/verify verbs. It's excluded otherwise, not just
// hidden: answering it "Yes" under "Verify" and later switching the verb to
// "Send" would otherwise leave a phantom keep nothing on screen explains.
// q4 is a redirect flag — it warns, it never decides.
export function verdict(step: Pick<Step, "verb" | "keep_decision" | `signal_q${1 | 2 | 3 | 4 | 5}`>): {
  computed: Verdict;
  effective: Verdict;
} {
  const isCheck = step.verb != null && VERB_KIND[step.verb] === "check";
  const decisive = [step.signal_q1, step.signal_q2, ...(isCheck ? [step.signal_q3] : []), step.signal_q5];

  let computed: Verdict;
  if (decisive.some((v) => v === true)) computed = "keep";
  else if (decisive.every((v) => v === false)) computed = "cut";
  else if (decisive.every((v) => v == null)) computed = "pending";
  else computed = "review";

  const override = step.keep_decision;
  return {
    computed,
    effective: override === "keep" || override === "cut" ? override : computed,
  };
}

export function VerdictPill({ value, className }: { value: Verdict; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex flex-none items-center rounded-md px-2 py-0.5 text-label-small font-medium",
        value === "keep" && "bg-m-primary-container text-m-on-primary-container",
        value === "cut" && "bg-m-error-container text-m-on-error-container",
        value === "review" && "bg-m-tertiary-container text-m-on-tertiary-container",
        value === "pending" && "bg-m-surface-container-high text-m-on-surface-variant",
        className
      )}
      // The two "excluded" ideas in this app are independent: a cut candidate
      // still pushes to ClickUp unless its ClickUp switch is off.
      title={
        value === "cut"
          ? "Cut candidate — still pushes to ClickUp unless you turn its ClickUp switch off"
          : undefined
      }
    >
      {VERDICT_LABEL[value]}
    </span>
  );
}

export function VerbSelect({
  value,
  onChange,
  label,
  className,
}: {
  value: string | null;
  onChange: (verb: string | null) => void;
  label: string;
  className?: string;
}) {
  return (
    <select
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value || null)}
      className={cn(
        "h-10 rounded-md border border-m-outline-variant bg-m-surface px-2 text-label-small text-m-on-surface",
        className
      )}
    >
      <option value="">Verb…</option>
      {VERB_GROUPS.map((g) => (
        <optgroup key={g.kind} label={g.label}>
          {g.verbs.map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function YesNo({
  value,
  onChange,
  label,
}: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
  label: string;
}) {
  return (
    <div className="flex flex-none gap-1">
      {[true, false].map((choice) => (
        <button
          key={String(choice)}
          type="button"
          aria-pressed={value === choice}
          aria-label={`${choice ? "Yes" : "No"} — ${label}`}
          // Re-clicking the active answer clears it back to unanswered, which
          // is a different verdict input from "No".
          onClick={() => onChange(value === choice ? null : choice)}
          className={cn(
            "h-6 w-11 rounded-md border text-label-small transition-colors",
            value === choice
              ? "border-m-primary bg-m-primary text-m-on-primary"
              : "border-m-outline-variant bg-m-surface text-m-on-surface-variant hover:bg-m-surface-container-high"
          )}
        >
          {choice ? "Yes" : "No"}
        </button>
      ))}
    </div>
  );
}

/** The full question grid + keep/cut override. Commits one field per click. */
export function SignalNoise({
  step,
  onPatch,
}: {
  step: Step;
  onPatch: (patch: StepUpdate) => void;
}) {
  const { computed, effective } = verdict(step);
  const isCheck = step.verb != null && VERB_KIND[step.verb] === "check";
  const questions = QUESTIONS.filter((q) => !("checkOnly" in q && q.checkOnly) || isCheck);

  return (
    <div className="space-y-2 rounded-lg bg-m-surface-container p-3">
      {questions.map((q) => (
        <div key={q.field} className="flex items-center justify-between gap-3">
          <span className="text-label-medium text-m-on-surface">{q.text}</span>
          <YesNo
            value={step[q.field] as boolean | null}
            label={q.text}
            onChange={(v) => onPatch({ [q.field]: v })}
          />
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2 border-t border-m-outline-variant pt-2">
        <VerdictPill value={effective} />
        {(["keep", "cut"] as const).map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={step.keep_decision === choice}
            // Re-clicking an active override hands the verdict back to the
            // questions — otherwise there's no route back to 'auto'.
            onClick={() =>
              onPatch({ keep_decision: step.keep_decision === choice ? "auto" : choice })
            }
            className={cn(
              "h-6 rounded-md border px-2.5 text-label-small transition-colors",
              step.keep_decision === choice
                ? "border-m-primary bg-m-primary text-m-on-primary"
                : "border-m-outline-variant bg-m-surface text-m-on-surface-variant hover:bg-m-surface-container-high"
            )}
          >
            {choice === "keep" ? "Force keep" : "Force cut"}
          </button>
        ))}
        {computed === "keep" && step.keep_decision === "auto" && (
          <span className="text-label-small text-m-on-surface-variant">
            Already a keep — the rest of these are optional.
          </span>
        )}
        {step.signal_q4 === true && (
          <span className="text-label-small text-m-error">
            This may be compensating for a broken earlier step.
          </span>
        )}
      </div>
    </div>
  );
}
