import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { PulseAlert } from '@/types/pulse'

const levelStyles: Record<PulseAlert['level'], { strip: string; badge: string; badgeText: string }> = {
  overdue: { strip: 'border-l-4 border-m-error', badge: 'bg-m-error text-m-on-error', badgeText: 'OVERDUE' },
  watch:   { strip: 'border-l-4 border-amber-400', badge: 'bg-amber-400 text-white', badgeText: 'WATCH' },
  flag_am: { strip: 'border-l-4 border-m-tertiary', badge: 'bg-m-tertiary text-m-on-tertiary', badgeText: 'FLAG AM' },
}

export function AlertsStrip({ alerts }: { alerts: PulseAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-3 text-body-small font-semibold text-green-800">
        ✓ All clear — no alerts today
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-m-error-container bg-m-error-container overflow-hidden">
      <div className="px-4 py-2 bg-m-error">
        <span className="text-label-small font-bold text-m-on-error uppercase tracking-wide">
          ⚠ {alerts.length} item{alerts.length !== 1 ? 's' : ''} need{alerts.length === 1 ? 's' : ''} your attention
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        {alerts.map(alert => {
          const s = levelStyles[alert.level]
          return (
            <div key={alert.id} className={cn('flex items-center gap-3 rounded bg-m-surface px-3 py-2', s.strip)}>
              <p className="flex-1 text-body-small text-m-on-surface">{alert.message}</p>
              <Link to={alert.linkTo} className={cn('shrink-0 rounded-full px-3 py-0.5 text-label-small font-bold', s.badge)}>
                {s.badgeText}
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
