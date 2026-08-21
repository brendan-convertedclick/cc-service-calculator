// Verb picker for one step. Used by the Steps pane and the canvas Block
// inspector.
import { cn } from "@/lib/utils";

// The GROUP a verb sits in is the point, not the word: a "handoff" verb marks a
// step boundary.
const VERB_GROUPS: { label: string; kind: string; verbs: string[] }[] = [
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
