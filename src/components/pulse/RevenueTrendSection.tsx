import { Link } from 'react-router-dom'
import { formatZar as fmt } from '@/lib/utils'
import { LimitedList } from './LimitedList'
import type { RevenueTrendRow } from '@/types/pulse'

export function RevenueTrendSection({ rows }: { rows: RevenueTrendRow[] | null }) {
  if (!rows) {
    return (
      <section>
        <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Revenue Trend</h2>
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container-low p-4 text-body-small text-m-on-surface-variant">
          <Link to="/settings?connect=xero" className="underline">Connect Xero</Link> to see revenue trends.
        </div>
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Revenue Trend — Client MoM</h2>
      <LimitedList
        items={rows}
        className="flex flex-col gap-2"
        renderItem={r => {
          const maxCents = Math.max(...r.months.map(m => m.cents), 1)
          return (
            <div key={r.clientId} className="flex items-center gap-3 rounded-lg bg-m-surface-container px-3 py-2.5">
              <span className="w-28 truncate text-body-small font-medium text-m-on-surface">{r.clientName}</span>
              <div className="flex items-end gap-0.5 h-5">
                {r.months.map((m, i) => (
                  <div
                    key={m.label}
                    className={i === 2 ? 'w-2 rounded-sm bg-m-primary' : 'w-2 rounded-sm bg-m-primary/40'}
                    style={{ height: `${Math.max((m.cents / maxCents) * 20, 2)}px` }}
                    title={`${m.label}: ${fmt(m.cents)}`}
                  />
                ))}
              </div>
              <span className={`text-label-small font-bold ${r.trend === 'up' ? 'text-green-600' : r.trend === 'down' ? 'text-m-error' : 'text-m-on-surface-variant'}`}>
                {r.momChangePct !== null ? `${r.momChangePct >= 0 ? '+' : ''}${r.momChangePct}%` : '→'}
              </span>
              <span className="ml-auto text-body-small text-m-on-surface-variant">{fmt(r.thisMonthCents)}</span>
            </div>
          )
        }}
      />
    </section>
  )
}
