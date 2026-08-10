import { Link } from 'react-router-dom'
import { cn, formatZar as fmt } from '@/lib/utils'
import { LimitedList } from './LimitedList'
import type { RetainerBurnRow } from '@/types/pulse'

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
                    {r.hoursUsed > 0 && <><span className="font-mono tabular-nums">{r.hoursUsed}</span>h used · </>}no hours target set
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
                    <span className="font-mono tabular-nums">{fmt(r.feePerMonthCents)}</span>/mo · <span className="font-mono tabular-nums">{r.hoursTarget}</span>h target
                  </span>
                </span>
                <span className={cn('text-label-small font-semibold', r.rag === 'green' ? 'text-m-on-surface-variant' : r.rag === 'amber' ? 'text-amber-700' : 'text-m-error')}>
                  <span className="font-mono tabular-nums">{r.hoursUsed}</span>h / <span className="font-mono tabular-nums">{r.hoursTarget}</span>h
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-m-surface-container-high">
                <div className={cn('h-full rounded-full transition-all', barColor[r.rag])} style={{ width: `${Math.min(r.burnPct, 100)}%` }} />
              </div>
              <p className={cn('mt-1 text-label-small', r.isOverrunRisk ? 'text-amber-700 font-medium' : 'text-m-on-surface-variant')}>
                <span className="font-mono tabular-nums">{r.burnPct}</span>% · <span className="font-mono tabular-nums">{r.daysLeftInMonth}</span> days left
                {r.isOverrunRisk && ' · at risk of overrun'}
                {r.isUnderutilised && ' · under-utilised'}
                {' · '}<span className="font-mono tabular-nums">{fmt(r.effectiveHourlyRateCents)}</span>/h effective rate
              </p>
            </div>
          )}
        />
      )}
    </section>
  )
}
