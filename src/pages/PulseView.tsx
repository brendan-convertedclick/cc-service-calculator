import { useState } from 'react'
import { useAvgDftCycleTime } from '@/hooks/useAvgDftCycleTime'
import { currentMonthKey, usePulseRetainerBurn } from '@/hooks/usePulseRetainerBurn'
import { usePulseWipFunnel } from '@/hooks/usePulseWipFunnel'
import { usePulseArAging } from '@/hooks/usePulseArAging'
import { usePulseClientHealth } from '@/hooks/usePulseClientHealth'
import { usePulsePricingHealth } from '@/hooks/usePulsePricingHealth'
import { usePulseRevenueTrend } from '@/hooks/usePulseRevenueTrend'
import { computeAlerts } from '@/hooks/usePulseAlerts'
import { cn } from '@/lib/utils'
import { PulseScoreboard } from '@/components/pulse/PulseScoreboard'
import { RetainerBurnSection } from '@/components/pulse/RetainerBurnSection'
import { WipFunnelSection } from '@/components/pulse/WipFunnelSection'
import { ArAgingSection } from '@/components/pulse/ArAgingSection'
import { ClientHealthSectionConnected } from '@/components/pulse/ClientHealthSection'
import { PricingHealthSection } from '@/components/pulse/PricingHealthSection'
import { RevenueTrendSection } from '@/components/pulse/RevenueTrendSection'

export function PulseView() {
  const [burnMonth, setBurnMonth] = useState(() => currentMonthKey())
  const retainerBurn  = usePulseRetainerBurn(burnMonth)
  // Alerts stay anchored to the current month regardless of the picked month.
  const currentBurn   = usePulseRetainerBurn(currentMonthKey())
  const wipFunnel     = usePulseWipFunnel()
  const arAging       = usePulseArAging()
  const clientHealth  = usePulseClientHealth()
  const pricingHealth = usePulsePricingHealth()
  const revenueTrend  = usePulseRevenueTrend()
  const dftCycle      = useAvgDftCycleTime()

  const wipWithCycle = { ...wipFunnel, avgCycleDays: dftCycle?.avgDays ?? null }
  const alerts = computeAlerts(currentBurn, arAging ?? [], clientHealth, [])

  // The scoreboard tiles carry the drill-down; the page just needs the one-line verdict.
  const overdueCount = alerts.filter(a => a.level === 'overdue').length
  const watchCount = alerts.filter(a => a.level === 'watch').length
  const verdict = overdueCount > 0
    ? { text: `${overdueCount} urgent item${overdueCount !== 1 ? 's' : ''} need${overdueCount === 1 ? 's' : ''} action`, dot: 'bg-m-error', tone: 'text-m-error' }
    : watchCount > 0
      ? { text: `Nothing urgent — ${watchCount} to watch`, dot: 'bg-amber-400', tone: 'text-amber-700' }
      : { text: 'All clear today', dot: 'bg-green-500', tone: 'text-green-700' }

  return (
    <div className="flex flex-col gap-6 overflow-auto p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-headline-medium text-m-on-surface">Business Pulse</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-body-small">
            <span className="text-m-on-surface-variant">
              {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            <span aria-hidden="true" className="text-m-on-surface-variant">·</span>
            <span className={cn('inline-flex items-center gap-1.5 font-medium', verdict.tone)}>
              <span className={cn('h-1.5 w-1.5 rounded-full', verdict.dot)} />
              {verdict.text}
            </span>
          </p>
        </div>
        <label className="flex flex-col gap-1 text-label-small font-medium text-m-on-surface-variant">
          Month
          <input
            type="month"
            aria-label="Select month"
            value={burnMonth}
            onChange={e => e.target.value && setBurnMonth(e.target.value)}
            className="h-10 rounded-md border border-m-outline-variant bg-transparent px-3 py-1.5 text-body-small font-normal text-m-on-surface"
          />
        </label>
      </div>

      <PulseScoreboard arBands={arAging} retainers={currentBurn} clientHealth={clientHealth} wip={wipWithCycle} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <RetainerBurnSection rows={retainerBurn} month={burnMonth} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <WipFunnelSection data={wipWithCycle} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <ArAgingSection bands={arAging} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <ClientHealthSectionConnected rows={clientHealth} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <PricingHealthSection data={pricingHealth} />
        </div>
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <RevenueTrendSection rows={revenueTrend} />
        </div>
      </div>
    </div>
  )
}
