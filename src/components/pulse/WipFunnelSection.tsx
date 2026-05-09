import type { WipFunnelData } from '@/types/pulse'

const stageColors = ['bg-indigo-500', 'bg-violet-500', 'bg-violet-400', 'bg-violet-300', 'bg-green-500']

export function WipFunnelSection({ data }: { data: WipFunnelData }) {
  const max = Math.max(...data.stages.map(s => s.count), 1)

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        WIP Pipeline
      </h2>
      <div className="flex items-end gap-2 h-16">
        {data.stages.map((s, i) => (
          <div key={s.stage} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-label-small font-bold text-m-on-surface">{s.count}</span>
            <div
              className={`w-full rounded-t ${stageColors[i]}`}
              style={{ height: `${Math.max((s.count / max) * 48, 4)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2">
        {data.stages.map(s => (
          <div key={s.stage} className="flex-1 text-center text-label-small text-m-on-surface-variant truncate">
            {s.stage}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-m-surface-container px-3 py-2 text-body-small text-m-on-surface-variant">
        Conversion:{' '}
        <strong className="text-m-on-surface">
          {data.conversionRate !== null ? `${data.conversionRate}%` : '—'}
        </strong>{' '}
        brief→accepted
        {data.avgCycleDays !== null && (
          <> · Avg cycle: <strong className="text-m-on-surface">{data.avgCycleDays}d</strong></>
        )}
      </div>
    </section>
  )
}
