import type { WipFunnelData } from '@/types/pulse'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// Height + label carry the data; colour only marks the terminal "won" stage. One hue, not a decorative ramp.
const stageColor = (i: number, last: number) => (i === last ? 'bg-green-500' : 'bg-m-primary')

const MAX_TOOLTIP_ITEMS = 8

export function WipFunnelSection({ data }: { data: WipFunnelData }) {
  const max = Math.max(...data.stages.map(s => s.count), 1)

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        WIP Pipeline
      </h2>
      <TooltipProvider delayDuration={200}>
        <div className="flex items-end gap-2 h-16">
          {data.stages.map((s, i) => (
            <Tooltip key={s.stage}>
              <TooltipTrigger asChild>
                <div className="flex flex-1 cursor-default flex-col items-center gap-1">
                  <span className="text-label-small font-bold text-m-on-surface">{s.count}</span>
                  <div
                    className={`w-full rounded-t ${stageColor(i, data.stages.length - 1)}`}
                    style={{ height: `${Math.max((s.count / max) * 48, 4)}px` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <p className="font-semibold">{s.stage} — {s.count}</p>
                {s.itemNames.length === 0 ? (
                  <p className="opacity-70">No items</p>
                ) : (
                  <ul className="mt-0.5">
                    {s.itemNames.slice(0, MAX_TOOLTIP_ITEMS).map((name, idx) => (
                      <li key={s.itemIds[idx] ?? idx} className="truncate">{name}</li>
                    ))}
                    {s.itemNames.length > MAX_TOOLTIP_ITEMS && (
                      <li className="opacity-70">+{s.itemNames.length - MAX_TOOLTIP_ITEMS} more</li>
                    )}
                  </ul>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <div className="mt-1 flex gap-2">
        {data.stages.map(s => (
          <div key={s.stage} className="flex-1 text-center text-label-small text-m-on-surface-variant truncate">
            {s.stage}
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-m-outline-variant bg-m-surface-container-low px-3 py-2 text-body-small text-m-on-surface-variant">
        Conversion:{' '}
        <strong className="font-mono font-semibold tabular-nums text-m-on-surface">
          {data.conversionRate !== null ? `${data.conversionRate}%` : '—'}
        </strong>{' '}
        brief→accepted
        {data.avgCycleDays !== null && (
          <> · Avg cycle: <strong className="font-mono font-semibold tabular-nums text-m-on-surface">{data.avgCycleDays}d</strong></>
        )}
      </div>
    </section>
  )
}
