interface ProgressRingProps {
  taskPct: number;
  timePct: number;
  size?: number;
  title?: string;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

export function ProgressRing({ taskPct, timePct, size = 44, title }: ProgressRingProps) {
  const stroke = 4;
  const gap = 2;
  const outerR = (size - stroke) / 2;
  const innerR = outerR - stroke - gap;
  const outerC = 2 * Math.PI * outerR;
  const innerC = 2 * Math.PI * innerR;

  const t = clamp(taskPct);
  const h = clamp(timePct);
  const overHours = timePct > 1;

  const label = Math.round(t * 100);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={title ?? `${label}% complete`}
    >
      {title && <title>{title}</title>}
      {/* Outer track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={outerR}
        fill="none"
        stroke="var(--m-surface-container-high, #e7e0ec)"
        strokeWidth={stroke}
      />
      {/* Outer = task % */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={outerR}
        fill="none"
        stroke="var(--mcolor-primary, #6750a4)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${outerC * t} ${outerC}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {/* Inner track */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={innerR}
        fill="none"
        stroke="var(--m-surface-container-high, #e7e0ec)"
        strokeWidth={stroke}
      />
      {/* Inner = time %. Red when over-budget. */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={innerR}
        fill="none"
        stroke={overHours ? "var(--mcolor-error, #b3261e)" : "var(--mcolor-tertiary, #7d5260)"}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${innerC * h} ${innerC}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-m-on-surface"
        style={{ fontSize: size * 0.28, fontWeight: 600 }}
      >
        {label}%
      </text>
    </svg>
  );
}
