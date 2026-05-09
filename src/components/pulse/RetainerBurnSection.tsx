import { cn } from '@/lib/utils'
import type { RetainerBurnRow } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

const barColor: Record<RetainerBurnRow['rag'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-m-error',
}

export function RetainerBurnSection({ rows }: { rows: RetainerBurnRow[] }) {
  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        Retainer Burn — {new Date().toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })}
      </h2>
      {rows.length === 0 ? (
        <p className="text-body-small text-m-on-surface-variant">No retainer clients configured.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map(r => (
            <div key={r.projectId}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-body-small font-semibold text-m-on-surface">
                  {r.clientName}{' '}
                  <span className="text-label-small font-normal text-m-on-surface-variant">
                    {fmt(r.feePerMonthCents)}/mo · {r.hoursTarget}h target
                  </span>
                </span>
                <span className={cn('text-label-small font-semibold', r.rag === 'green' ? 'text-m-on-surface-variant' : r.rag === 'amber' ? 'text-amber-700' : 'text-m-error')}>
                  {r.hoursUsed}h / {r.hoursTarget}h
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
                <div className={cn('h-full rounded-full transition-all', barColor[r.rag])} style={{ width: `${Math.min(r.burnPct, 100)}%` }} />
              </div>
              <p className={cn('mt-1 text-label-small', r.isOverrunRisk ? 'text-amber-700 font-medium' : 'text-m-on-surface-variant')}>
                {r.burnPct}% · {r.daysLeftInMonth} days left
                {r.isOverrunRisk && ' · at risk of overrun'}
                {r.isUnderutilised && ' · under-utilised'}
                {' · '}{fmt(r.effectiveHourlyRateCents)}/h effective rate
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
