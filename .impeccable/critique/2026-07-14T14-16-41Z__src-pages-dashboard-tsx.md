---
target: src/pages/Dashboard.tsx
total_score: 21
p0_count: 1
p1_count: 2
timestamp: 2026-07-14T14-16-41Z
slug: src-pages-dashboard-tsx
---
# Critique: src/pages/Dashboard.tsx (Method: dual-agent A+B)

CRITICAL: src/pages/Dashboard.tsx is DEAD CODE — imported nowhere. Live `/` route renders DashboardPage → DashboardShell (src/components/dashboard/DashboardShell.tsx). Two assessments landed on different surfaces.

## Design Health Score — Dashboard.tsx (orphaned file): 21/40 (Acceptable)
1 Visibility 1 | 2 Match 3 | 3 Control 3 | 4 Consistency 3 | 5 ErrorPrev 2 | 6 Recognition 3 | 7 Flexibility 1 | 8 Aesthetic 2 | 9 ErrorRecovery 1 | 10 Help 2

## Anti-patterns
Dashboard.tsx: textbook AI-SaaS cliché (identical card grid + big-number metric). It's dead code — main problem is it exists.
DashboardShell (live): detector found 18 (half app-shell, discount). Dashboard-specific verified issues below.

## Priority Issues
[P0] Named file src/pages/Dashboard.tsx is orphaned — delete it.
[P1] Live dashboard fails WCAG AA contrast: project names/labels ~2.9:1 (rgb 155,144,173 on #FAFAFA, 12px); tags 9–11px 0.6-opacity violet. Cmd: harden/audit.
[P1] Recent-project cards undifferentiated (same status dot + "On track" chip; only name differs) — can't triage. Cmd: layout/bolder.
[P2] Em-dash empty states render as heavy black "—" / bare em-dash flash — read as broken. Cmd: harden.
[P2] Nested cards (4) in CAPACITY & DELIVERY HEALTH tile — DESIGN.md: nested cards always wrong. Cmd: distill.
[P2] Orphaned "Health narrative" label — no card/content/affordance.
[P3] One truncate label overflows box by 67px.
[P1/dead-file] Dashboard.tsx: no loading/empty/error states; stats not JetBrains Mono (violates Numbers-Are-Mono); hover-only focus; no reduced-motion guard.

## What's working (live surface)
Restrained gradient discipline; full token discipline (no hardcoded hex); gently-lifted cards honor Soft-Shadow rule.

## Persona red flags
Alex: live dashboard gives signal but can't triage (identical cards); tiny low-contrast labels slow scan.
Sam: 2.9:1 contrast + 9-11px fail AA; hover-only lift, no group-focus-visible; unguarded translate; icons lack aria-hidden.
