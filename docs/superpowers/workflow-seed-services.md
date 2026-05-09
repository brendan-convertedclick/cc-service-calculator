# Workflow Template Seeding Guide

Use the "Generate steps with AI" button on each service's edit page (`/services/:id`)
to populate process steps. Prioritise these services first:

## Tier 1 — Seed immediately (core delivery services)

| Service | Code | Why |
|---------|------|-----|
| Full Website Build Page - Development & SEO | 004 | Most common web deliverable |
| Full Website Build Page - Development, No SEO | 002 | Common web deliverable |
| Emailer - Creative and development | 008 | High-frequency creative service |
| Content Calendar | 135 | Retainer staple |
| Brochure Design | 39 | Common one-off |
| Facebook - Static Image - Design and Copy | 104 | Most common social post type |
| Instagram - Carousel - Design and Copy | 114 | High-frequency social |
| 3D Rendering - High Res Video | 3D0101 | Video production anchor |

## Tier 2 — Seed next sprint

- Google Ads Campaign Setup (Paid Media)
- SEO Audit
- Social Media Strategy
- Landing Page Build
- GDN Banners - Creative and Content
- Content Strategy (3 month)
- Analytics Setup

## How to seed

1. Start the dev server: `npm run dev`
2. Navigate to `/services/:id` for each service above
3. Click "Generate steps with AI" in the Process Flow section
4. Review and save the generated steps

Once 5+ projects have completed for a service type, the accuracy report
(Phase 2 feature) will start showing calibration data.
