// src/lib/scope-map-layout.ts
//
// Pure, deterministic layout engine for the Scope Map visualization.
// Computes chip positions in an abstract square coordinate space (typically
// 800×800 rendered through an SVG viewBox + %-positioned HTML chips).
//
// - Inside items: golden-angle (phyllotaxis) placement, radius scaled by
//   AI confidence — high confidence sits near the centre, low confidence
//   drifts toward the boundary.
// - Outside items: an outer ring beyond the circle, spread clockwise from
//   the top-right (full 360° when crowded).
// - A fixed-iteration pairwise-repulsion pass relaxes collisions, with
//   clamps keeping inside items inside and outside items outside + on-canvas.
//
// No dependencies, no Math.random — same input always yields same output.

export type LayoutItem = {
  ref: string;
  isInside: boolean;
  confidence: number;
};

export type ChipPosition = {
  ref: string;
  x: number;
  y: number;
  angleDeg: number;
};

export type ScopeMapLayout = {
  circle: { cx: number; cy: number; r: number };
  positions: ChipPosition[];
};

/** Golden angle in degrees — classic phyllotaxis constant. */
export const GOLDEN_ANGLE_DEG = 137.508;

const DEG_TO_RAD = Math.PI / 180;

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;

export function layoutScopeMap(items: LayoutItem[], size: number): ScopeMapLayout {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  const circle = { cx, cy, r };

  if (items.length === 0) return { circle, positions: [] };

  const inside = items.filter((i) => i.isInside);
  const outside = items.filter((i) => !i.isInside);

  type Working = ChipPosition & { isInside: boolean };
  const working = new Map<string, Working>();

  // --- Initial placement -------------------------------------------------
  // Inside: golden-angle spiral; radius grows as confidence drops so the
  // most certain matches cluster at the centre and shaky ones hug the edge.
  inside.forEach((item, i) => {
    const angleDeg = i * GOLDEN_ANGLE_DEG;
    const radius = r * (0.3 + 0.55 * (1 - clamp01(item.confidence)));
    working.set(item.ref, {
      ref: item.ref,
      x: cx + radius * Math.cos(angleDeg * DEG_TO_RAD),
      y: cy + radius * Math.sin(angleDeg * DEG_TO_RAD),
      angleDeg,
      isInside: true,
    });
  });

  // Outside: ring at r*1.42 starting at -80° (top-right in SVG y-down
  // coordinates), stepping clockwise around the right/bottom. With more
  // than 10 items, spread over the full 360°.
  const outerRadius = r * 1.42;
  const startDeg = -80;
  const spanDeg = outside.length > 10 ? 360 : 240;
  const stepDeg = spanDeg / Math.max(outside.length, 1);
  outside.forEach((item, i) => {
    const angleDeg = startDeg + i * stepDeg;
    working.set(item.ref, {
      ref: item.ref,
      x: cx + outerRadius * Math.cos(angleDeg * DEG_TO_RAD),
      y: cy + outerRadius * Math.sin(angleDeg * DEG_TO_RAD),
      angleDeg,
      isInside: false,
    });
  });

  // --- Collision relaxation ----------------------------------------------
  const minDist = size * 0.13; // approximate chip footprint
  const insideMax = r * 0.88; // inside chips stay within the circle
  const outsideMin = r * 1.12; // outside chips stay clear of the boundary
  const pad = size * 0.08; // canvas padding

  const nodes = items
    .map((i) => working.get(i.ref))
    .filter((n): n is Working => n !== undefined);

  const applyClamps = (n: Working) => {
    // Radial clamp relative to the circle centre.
    let dx = n.x - cx;
    let dy = n.y - cy;
    let dist = Math.hypot(dx, dy);
    if (dist === 0) {
      // Coincident with centre — nudge along a deterministic direction.
      dx = Math.cos(n.angleDeg * DEG_TO_RAD);
      dy = Math.sin(n.angleDeg * DEG_TO_RAD);
      dist = 1;
      n.x = cx + dx;
      n.y = cy + dy;
    }
    if (n.isInside && dist > insideMax) {
      const s = insideMax / dist;
      n.x = cx + dx * s;
      n.y = cy + dy * s;
    } else if (!n.isInside && dist < outsideMin) {
      const s = outsideMin / dist;
      n.x = cx + dx * s;
      n.y = cy + dy * s;
    }
    // Box clamp — keep every chip on the canvas.
    n.x = Math.max(pad, Math.min(size - pad, n.x));
    n.y = Math.max(pad, Math.min(size - pad, n.y));
  };

  for (let iter = 0; iter < 24; iter++) {
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const na = nodes[a];
        const nb = nodes[b];
        let dx = nb.x - na.x;
        let dy = nb.y - na.y;
        let dist = Math.hypot(dx, dy);
        if (dist >= minDist) continue;
        if (dist < 1e-9) {
          // Perfectly coincident — separate along a deterministic
          // index-derived direction (no randomness).
          const fallback = ((a * 73 + b * 139) % 360) * DEG_TO_RAD;
          dx = Math.cos(fallback);
          dy = Math.sin(fallback);
          dist = 1;
        }
        const push = (minDist - Math.min(dist, minDist)) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        na.x -= ux * push;
        na.y -= uy * push;
        nb.x += ux * push;
        nb.y += uy * push;
      }
    }
    nodes.forEach(applyClamps);
  }
  nodes.forEach(applyClamps);

  // Preserve the caller's item order in the output.
  const positions: ChipPosition[] = nodes.map((n) => ({
    ref: n.ref,
    x: n.x,
    y: n.y,
    angleDeg: n.angleDeg,
  }));

  return { circle, positions };
}
