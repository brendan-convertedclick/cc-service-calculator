// src/pages/ProcedureWizard.tsx
//
// /procedure-wizard — the triage that runs BEFORE a procedure exists: is this
// worth systemising at all, and is it actually process rather than judgment?
// Ported verbatim (factors, thresholds, wording) from procedure-builder.html so
// the verdicts read the same as the prototype everyone already argued about.
//
// Nothing here is persisted — it's a decision aid that ends in "create it" or
// "don't". Writes only happen if you take the Create procedure exit.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// "System / task" is deliberate and matches the prototype: the thing being
// triaged is a candidate task; the artefact you might build from it is the
// procedure.
const SCORE_FIELDS = [
  { key: "freq", label: "Frequency — how often is this done, and by how many people?" },
  { key: "cost", label: "Cost of error — how expensive or client-facing is a mistake here?" },
  { key: "train", label: "Training burden — does this need 1:1 time with your best person?" },
  { key: "consist", label: "Consistency gap — does output visibly vary by who does it?" },
] as const;

type ScoreKey = (typeof SCORE_FIELDS)[number]["key"];

const TACIT_ITEMS = [
  "It's rare or genuinely one-off — a system would cost more to write than it would ever save.",
  "Every instance is meaningfully different — a template would need so many branches it stops helping.",
  "The right call depends on reading a person, not a pattern.",
  "It requires years of pattern-matching a checklist can't shortcut.",
  "A rigid script would make the output worse, not just slower.",
];

type Band = "build" | "light" | "dont";

const BAND_CLASS: Record<Band, string> = {
  build: "bg-m-primary-container text-m-on-primary-container",
  light: "bg-m-tertiary-container text-m-on-tertiary-container",
  dont: "bg-m-error-container text-m-on-error-container",
};

function test1Band(total: number): { band: Band; msg: string } {
  if (total >= 16) return { band: "build", msg: "Build it now." };
  if (total >= 10) return { band: "light", msg: "Build a light version." };
  return { band: "dont", msg: "Don't build one — leave a one-line note if anything." };
}

export function ProcedureWizard() {
  const [name, setName] = useState("");
  const [scores, setScores] = useState<Record<ScoreKey, number>>({
    freq: 3,
    cost: 3,
    train: 3,
    consist: 3,
  });
  // null = unanswered; the prototype defaults these to "No", and so does the
  // count below — an unanswered item simply isn't a judgment signal.
  const [tacit, setTacit] = useState<(boolean | null)[]>(() => TACIT_ITEMS.map(() => null));

  const total = useMemo(
    () => SCORE_FIELDS.reduce((sum, f) => sum + scores[f.key], 0),
    [scores]
  );
  const { band, msg } = test1Band(total);
  const tacitCount = tacit.filter(Boolean).length;
  const mostlyJudgment = tacitCount >= 3;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-headline-medium">Procedure wizard</h1>
        <p className="max-w-2xl text-body-medium text-m-on-surface-variant">
          Run a candidate task through the filter, step by step. Every recommendation below is a
          suggestion, not a lock — override anything, and see where the filter agrees with your gut
          and where it doesn't.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-1.5 pt-5">
          <Label htmlFor="wizard-name" className="text-label-small uppercase tracking-wide">
            System / task name
          </Label>
          <Input
            id="wizard-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Client onboarding, campaign build, SOW approval…"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-title-medium">Test 1 — does this need to be a system at all?</CardTitle>
          <p className="text-body-small text-m-on-surface-variant">Score each factor 1 (low) to 5 (high).</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {SCORE_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`score-${f.key}`} className="text-body-small font-normal">
                  {f.label}
                </Label>
                <div className="flex items-center gap-3">
                  <input
                    id={`score-${f.key}`}
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={scores[f.key]}
                    onChange={(e) => setScores({ ...scores, [f.key]: Number(e.target.value) })}
                    className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-m-surface-container-high accent-m-primary"
                  />
                  <span className="w-4 text-right font-mono text-label-large text-m-on-surface">
                    {scores[f.key]}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <p className={cn("rounded-lg px-3 py-2 text-body-medium", BAND_CLASS[band])}>
            <b>{total} / 20</b> — {msg}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1 pb-3">
          <CardTitle className="text-title-medium">Is this actually judgment, not a process?</CardTitle>
          <p className="text-body-small text-m-on-surface-variant">
            Check anything that's true. Three or more, and this probably shouldn't be a rigid
            step-by-step system.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {TACIT_ITEMS.map((item, i) => (
            <div key={item} className="flex items-center justify-between gap-4">
              <span className="text-body-medium text-m-on-surface">{item}</span>
              <div className="flex flex-none gap-1">
                {[true, false].map((choice) => (
                  <button
                    key={String(choice)}
                    type="button"
                    aria-pressed={tacit[i] === choice}
                    aria-label={`${choice ? "Yes" : "No"} — ${item}`}
                    onClick={() =>
                      setTacit(tacit.map((v, j) => (j === i ? (v === choice ? null : choice) : v)))
                    }
                    className={cn(
                      "h-7 w-12 rounded-md border text-label-small transition-colors",
                      tacit[i] === choice
                        ? "border-m-primary bg-m-primary text-m-on-primary"
                        : "border-m-outline-variant bg-m-surface text-m-on-surface-variant hover:bg-m-surface-container-high"
                    )}
                  >
                    {choice ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p
            className={cn(
              "rounded-lg px-3 py-2 text-body-medium",
              mostlyJudgment ? BAND_CLASS.light : BAND_CLASS.build
            )}
          >
            <b>{tacitCount} of 5</b> —{" "}
            {mostlyJudgment
              ? "mostly judgment. Document the scaffolding only (inputs, handoffs, quality bar) and leave the core open."
              : "this reads as real process, not judgment. Worth building out below."}
          </p>
        </CardContent>
      </Card>

      {/* The exit. Both verdicts are advisory — the button is always live, so a
          "don't build" score you disagree with costs one click, not a restart. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-title-medium">Verdict</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-body-medium text-m-on-surface-variant">
            {band === "dont"
              ? "Both tests point away from building this. Leave a one-line note where the work lives instead."
              : mostlyJudgment
                ? "Worth writing down, but keep it thin — inputs, handoffs and the quality bar, not a script."
                : "Worth building out. Create the procedure and start with the steps that would hurt if skipped."}
          </p>
          <Button asChild className="gap-1.5">
            {/* Carries the name through so the create dialog opens prefilled —
                the wizard's only output. */}
            <Link to={`/systems${name.trim() ? `?new=${encodeURIComponent(name.trim())}` : ""}`}>
              Create procedure <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
