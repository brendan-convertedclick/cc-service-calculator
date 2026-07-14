---
target: /briefs/910c03f5/scope (src/pages/Scope.tsx) RE-RUN
total_score: 34
p0_count: 0
p1_count: 2
timestamp: 2026-07-14T15-28-31Z
slug: src-pages-scope-tsx
---
# Re-critique: src/pages/Scope.tsx (dual-agent A+B) — after colorize/typeset/harden/distill

## Design Health Score: 34/40 (Good) — delta +9 from prior 25/40

1 Visibility 4 | 2 Match 4 | 3 Control 4 | 4 Consistency 2 | 5 ErrorPrev 3 | 6 Recognition 4 | 7 Flexibility 4 | 8 Aesthetic 3 | 9 ErrorRecovery 3 | 10 Help 3

## Fixes verified HELD (source + browser)
- Intent badge variant="muted" (Scope.tsx:190) — off gradient, contrast passes. RESOLVED.
- Receipt figures mono via <Money>/font-mono (StickyQuoteFooter, BucketBand, ServiceLineRow, CoverageBar + InlineNumber). RESOLVED.
- Lock scope gated behind confirm Dialog (Scope.tsx) with "Keep editing". RESOLVED.
- Bands flattened to tinted zones (BucketBand). RESOLVED.

## Remaining priority issues (all but one in BriefIntelligenceView)
[P1] BriefIntelligenceView 8x uppercase tracked eyebrows (188,212,236,300,335,365,424,576) — DESIGN Don't. Fix: drop uppercase tracking-wide, promote to title-small. Cmd: quieter.
[P1] Two confidence palettes / raw color: CONFIDENCE_COLOURS green/yellow/red (BriefIntelligenceView:25-29); Open-Questions yellow-50/900; Rejected banner red (Scope.tsx:317). Off-token + 2nd color language for same concept. Fix: reuse ConfidenceChip/Badge success|warning|muted + gold/destructive tokens. Cmd: colorize.
[P2] Emoji-as-icons in BriefIntelligenceView (bullet 219, deliverable 257, warn 305) — swap to Lucide. Cmd: polish.
[P2] Receipt line-summary "N tasks · Xh · Ypt" non-mono (ScopeConfirmStage:147 -> ServiceLineRow:189). Fix: font-mono the h/pt (needs string->ReactNode). Cmd: typeset.
[P2] ScopeEditor forced data-color-mode="light" — LATENT (dark mode unwired in app), backlog not blocker.

## Strengths
Scope Receipt is the model surface (mono money, tinted bands, grounding-quote popover, operator/client parity). Power-user inline number cells (keyboard commit, Esc-cancel, 0.25 step). Stage gating + auto-advance + back-nav legible.

## Persona
Alex: Stage 2 edit mode is an older-feeling Input stack + native <select> vs shadcn Select elsewhere — inconsistency a daily user feels.
Jordan: minimal risk (internal power-user tool); inline explainer copy carries them.

## Note: consistency (#4=2) is the sole anchor dragging the score; all of it lives in BriefIntelligenceView (Stage 2).
