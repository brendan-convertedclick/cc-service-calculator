import { useState } from 'react'
import { useAvgDftCycleTime } from '@/hooks/useAvgDftCycleTime'
import { currentMonthKey, usePulseRetainerBurn } from '@/hooks/usePulseRetainerBurn'
import { usePulseWipFunnel } from '@/hooks/usePulseWipFunnel'
import { usePulseArAging } from '@/hooks/usePulseArAging'
import { usePulseClientHealth } from '@/hooks/usePulseClientHealth'
import { usePulsePricingHealth } from '@/hooks/usePulsePricingHealth'
import { usePulseRevenueTrend } from '@/hooks/usePulseRevenueTrend'
import { computeAlerts } from '@/hooks/usePulseAlerts'
import { AlertsStrip } from '@/components/pulse/AlertsStrip'
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

  return (
    <div className="flex flex-col gap-6 overflow-auto p-6">
      <div>
        <h1 className="text-headline-medium text-m-on-surface">Business Pulse</h1>
        <p className="text-body-small text-m-on-surface-variant">
          {new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      <AlertsStrip alerts={alerts} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="rounded-xl border border-m-outline-variant bg-m-surface p-5">
          <RetainerBurnSection rows={retainerBurn} month={burnMonth} onMonthChange={setBurnMonth} />
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
