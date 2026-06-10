import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { ArAgingBand, ClientHealthRow, RetainerBurnRow, WipFunnelData } from '@/types/pulse'

const ZAR = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
const fmt = (cents: number) => ZAR.format(cents / 100)

interface PulseScoreboardProps {
  arBands: ArAgingBand[] | null
  retainers: RetainerBurnRow[]
  clientHealth: ClientHealthRow[]
  wip: WipFunnelData
}

function Tile({ title, to, linkLabel, children }: { title: string; to: string; linkLabel: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-m-outline-variant bg-m-surface p-4 transition-shadow hover:shadow-elev-1">
      <h3 className="mb-2 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">{title}</h3>
      <div className="flex-1">{children}</div>
      <Link to={to} className="mt-3 text-label-small font-medium text-m-primary hover:underline">
        {linkLabel} →
      </Link>
    </div>
  )
}

function Stat({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="text-headline-small font-semibold tabular-nums text-m-on-surface">
      {value}
      {unit && <span className="ml-1.5 text-body-small font-normal text-m-on-surface-variant">{unit}</span>}
    </p>
  )
}

function Sub({ tone = 'neutral', children }: { tone?: 'neutral' | 'error' | 'amber' | 'ok'; children: ReactNode }) {
  return (
    <p className={cn('mt-1 text-body-small', {
      neutral: 'text-m-on-surface-variant',
      error: 'font-medium text-m-error',
      amber: 'font-medium text-amber-700',
      ok: 'text-green-700',
    }[tone])}>
      {children}
    </p>
  )
}

/** Headline business numbers for the Pulse page — absorbs alert info into four KPI tiles. */
export function PulseScoreboard({ arBands, retainers, clientHealth, wip }: PulseScoreboardProps) {
  // Outstanding AR — same >30d rule as computeAlerts.
  const overdueInvoices = (arBands ?? []).flatMap(b => b.invoices.filter(i => i.daysOverdue > 30))
  const arTotal = (arBands ?? []).reduce((s, b) => s + b.totalCents, 0)
  const overdueTotal = overdueInvoices.reduce((s, i) => s + i.amountCents, 0)

  // Retainer health — same running-hot rule as computeAlerts.
  const configured = retainers.filter(r => !r.needsSetup)
  const hot = configured.filter(r => r.isOverrunRisk || r.burnPct >= 85)
  const hottest = hot.reduce<RetainerBurnRow | null>((m, r) => (m === null || r.burnPct > m.burnPct ? r : m), null)

  // Client touch — same 21-day threshold as computeAlerts.
  const followUpsDue = clientHealth.filter(c => c.daysSinceContact >= 21).length
  const contactedThisWeek = clientHealth.filter(c => c.daysSinceContact <= 7).length

  const accepted = wip.stages.find(s => s.stage === 'Accepted')?.count ?? 0

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile title="Outstanding AR" to="/reconciliation" linkLabel="Reconciliation">
        {arBands === null ? (
          <>
            <Stat value="—" />
            <Sub>Connect Xero to track AR</Sub>
          </>
        ) : (
          <>
            <Stat value={fmt(arTotal)} />
            {overdueInvoices.length > 0 ? (
              <Sub tone="error">
                {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} 30d+ overdue · {fmt(overdueTotal)}
              </Sub>
            ) : (
              <Sub tone="ok">Nothing 30d+ overdue</Sub>
            )}
          </>
        )}
      </Tile>

      <Tile title="Retainer health" to="/retainers" linkLabel="Retainers">
        {configured.length === 0 ? (
          <>
            <Stat value="—" />
            <Sub>No retainers configured</Sub>
          </>
        ) : (
          <>
            <Stat value={String(hot.length)} unit={`of ${configured.length} running hot`} />
            {hottest ? (
              <Sub tone="amber">Highest burn {hottest.burnPct}% · {hottest.daysLeftInMonth} days left</Sub>
            ) : (
              <Sub tone="ok">All on pace</Sub>
            )}
          </>
        )}
      </Tile>

      <Tile title="Client touch" to="/clients" linkLabel="Clients">
        <Stat value={String(followUpsDue)} unit={`follow-up${followUpsDue !== 1 ? 's' : ''} due`} />
        <Sub>{contactedThisWeek} contacted this week</Sub>
      </Tile>

      <Tile title="Work in flight" to="/briefs" linkLabel="Briefs">
        <Stat value={String(accepted)} unit="accepted in flight" />
        {wip.conversionRate !== null ? (
          <Sub>
            {wip.conversionRate}% brief→accepted{wip.avgCycleDays !== null && ` · ${wip.avgCycleDays}d avg cycle`}
          </Sub>
        ) : (
          <Sub>No briefs in the pipeline yet</Sub>
        )}
      </Tile>
    </div>
  )
}
