import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { LimitedList } from './LimitedList'
import type { RetainerBurnRow } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

const barColor: Record<RetainerBurnRow['rag'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-m-error',
}

interface RetainerBurnSectionProps {
  rows: RetainerBurnRow[]
  /** 'YYYY-MM' month being shown; defaults to the current month. Drives the heading label. */
  month?: string
}

export function RetainerBurnSection({ rows, month }: RetainerBurnSectionProps) {
  const monthLabel = (month ? new Date(`${month}-01T00:00:00`) : new Date())
    .toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
          Retainer Burn — {monthLabel}
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-body-small text-m-on-surface-variant">No retainer clients configured.</p>
      ) : (
        <LimitedList
          items={rows}
          className="flex flex-col gap-4"
          renderItem={r => r.needsSetup ? (
            <div key={r.projectId}>
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-body-small font-semibold text-m-on-surface">
                  {r.clientName}{' '}
                  <span className="text-label-small font-normal text-m-on-surface-variant">
                    {r.hoursUsed > 0 && `${r.hoursUsed}h used · `}no hours target set
                  </span>
                </span>
                <Link to="/retainers" className="text-label-small font-medium text-m-primary hover:underline">
                  Set target
                </Link>
              </div>
              <div className="h-2 w-full rounded-full border border-dashed border-m-outline-variant" />
            </div>
          ) : (
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
          )}
        />
      )}
    </section>
  )
}
