---
target: /briefs/910c03f5/scope (src/pages/Scope.tsx)
total_score: 25
p0_count: 0
p1_count: 3
timestamp: 2026-07-14T14-41-10Z
slug: src-pages-scope-tsx
---
# Critique: src/pages/Scope.tsx (Method: dual-agent A+B, live URL /briefs/910c03f5.../scope)

## Design Health Score: 25/40 (Acceptable — needs work)
1 Visibility 3 | 2 Match 3 | 3 Control 3 | 4 Consistency 2 | 5 ErrorPrev 2 | 6 Recognition 2 | 7 Flexibility 2 | 8 Aesthetic 2 | 9 ErrorRecovery 3 | 10 Help 3

## Anti-patterns (3 named DESIGN Don'ts, 2 detector-corroborated)
[P1] Intent badge (Scope.tsx:181) no variant → default bg-gradient-brand. Measured white-on-pink 3.53:1 FAIL (violet end 5.7:1). Reserved-Gradient violation + only real a11y defect. Both agents. Fix: variant="muted".
[P1] Numbers in Inter not JetBrains Mono — currency+hours in BriefIntelligenceView 270-291, ScopeConfirmStage:147. Violates Numbers-Are-Mono. Fix: font-mono. Cmd typeset.
[P1] Hardcoded palette dark-mode-broken — red-50/200/800 (Scope:308), confidence map, yellow-50/900. Semi-systemic (~10 files). Cmd colorize (app-wide).
Detector (app-shell discounted): nested-cards x4 (stage→band→rows→elev-3); truncate label overflow 67px; prose line ~157ch (no max-width).

## Priority
[P1] intent-badge gradient a11y — colorize (apply)
[P1] numbers not mono — typeset
[P1] hardcoded dark-mode-broken palette — colorize (systemic)
[P2] Lock-scope (Scope:366) unguarded, no confirm/summary, inverted peak-end — harden + delight
[P2] uppercase eyebrows x8 + emoji-as-icons in BriefIntelligenceView — quieter/polish
[P2] nested cards x4 — distill

## What works
Gated auto-advance accordion (Scope 105-114, StageSection) fully tokenized; state coverage in ScopeConfirmStage (skeleton/analyzing/empty/error+retry); warm commit-point copy.

## Persona
Alex: sequential accordion forces re-expand every visit; no keyboard/expand-all; non-mono figures.
Jordan: scariest action (Lock scope) least guidance; raw markdown editor Stage 3; routine reject styled alarm-red.

## Contrast (measured): only fail = intent badge white-on-pink 3.53:1. h1 19:1, sender 7.44:1, subtitles 7.76:1, confidence badges 6.78-7.09:1 all pass.
