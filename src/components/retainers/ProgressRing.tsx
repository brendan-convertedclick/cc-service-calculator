// One ring, three arcs: the track is the whole month, the grey arc is how far
// the month has run (or what should be done by today), the coloured arc is what
// has been done. Lifted out of RetainersDashboard (2026-09-16) so the retainer
// book can show planned vs completed the same way. Token CSS vars are HSL
// triplets, so strokes must be wrapped in hsl(var(...)).
const fmt = (n: number) => `${Math.round(n * 10) / 10}h`;

export function ProgressRing({
  done,
  expected,
  total,
  label,
  size = 128,
}: {
  done: number;
  expected: number;
  total: number;
  label?: string;
  size?: number;
}) {
  const stroke = size >= 64 ? 14 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = (n: number) => (total > 0 ? Math.min(1, Math.max(0, n / total)) : 0);
  const ring = (n: number, colour: string) => (
    <circle
      cx={size / 2}
      cy={size / 2}
      r={r}
      fill="none"
      stroke={colour}
      strokeWidth={stroke}
      strokeDasharray={`${c * frac(n)} ${c}`}
      transform={`rotate(-90 ${size / 2} ${size / 2})`}
    />
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${fmt(done)} done of ${fmt(expected)} expected so far, ${fmt(total)} in the month`}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--mcolor-surface-container-high))" strokeWidth={stroke} />
      {ring(expected, "hsl(var(--mcolor-outline))")}
      {ring(done, "hsl(var(--mcolor-primary))")}
      {label && (
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-m-on-surface font-mono"
          style={{ fontSize: size * 0.22, fontWeight: 600 }}
        >
          {label}
        </text>
      )}
    </svg>
  );
}
