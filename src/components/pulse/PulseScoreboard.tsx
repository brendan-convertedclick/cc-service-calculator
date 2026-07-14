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

const INVOICE_LIMIT = 2
const CHIP_LIMIT = 5
const BURN_BAR_LIMIT = 3

// Same canonical order and one-hue treatment as WipFunnelSection: primary bars, green terminal stage.
const WIP_STAGES = ['Received', 'Scoping', 'Quoted', 'Accepted', 'Delivered'] as const
const wipStageColor = (idx: number) => (idx === WIP_STAGES.length - 1 ? 'bg-green-500' : 'bg-m-primary')

// Same rag → bar colour mapping as RetainerBurnSection.
const burnBarColor: Record<RetainerBurnRow['rag'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-m-error',
}

function Tile({ title, to, linkLabel, children }: { title: string; to: string; linkLabel: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-m-outline-variant bg-m-surface p-4">
      <h2 className="mb-2 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">{title}</h2>
      <div className="flex-1">{children}</div>
      <Link to={to} className="mt-3 text-label-small font-medium text-m-primary hover:underline">
        {linkLabel} <span aria-hidden="true">→</span>
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
  const dueClients = clientHealth
    .filter(c => c.daysSinceContact >= 21)
    .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
  const followUpsDue = dueClients.length
  const contactedThisWeek = clientHealth.filter(c => c.daysSinceContact <= 7).length

  const accepted = wip.stages.find(s => s.stage === 'Accepted')?.count ?? 0
  const maxStageCount = Math.max(...wip.stages.map(s => s.count), 1)

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* "Overdue", not "outstanding": the AR hook only includes invoices already past due. */}
      <Tile title="Overdue AR" to="/reconciliation" linkLabel="Reconciliation">
        {arBands === null ? (
          <>
            <Stat value="—" />
            <Sub>Connect Xero to track AR</Sub>
          </>
        ) : (
          <>
            <Stat value={fmt(arTotal)} />
            {overdueInvoices.length > 0 ? (
              <>
                <Sub tone="error">
                  {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} 30d+ overdue · {fmt(overdueTotal)}
                </Sub>
                <ul className="mt-2 space-y-1.5">
                  {[...overdueInvoices].sort((a, b) => b.amountCents - a.amountCents).slice(0, INVOICE_LIMIT).map(i => (
                    <li key={i.id} className="flex items-center gap-1.5 text-label-small">
                      <span className="truncate font-medium text-m-on-surface">{i.clientName}</span>
                      {i.invoiceNumber && <span className="shrink-0 text-m-on-surface-variant">{i.invoiceNumber}</span>}
                      <span className="ml-auto shrink-0 font-semibold tabular-nums text-m-on-surface">{fmt(i.amountCents)}</span>
                      <span className="shrink-0 rounded-full bg-m-error-container px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-m-on-error-container">
                        {i.daysOverdue}d
                      </span>
                    </li>
                  ))}
                  {overdueInvoices.length > INVOICE_LIMIT && (
                    <li className="text-label-small text-m-on-surface-variant">+{overdueInvoices.length - INVOICE_LIMIT} more</li>
                  )}
                </ul>
              </>
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
            <ul className="mt-2 space-y-1.5">
              {[...configured].sort((a, b) => b.burnPct - a.burnPct).slice(0, BURN_BAR_LIMIT).map(r => (
                <li key={r.projectId} title={`${r.clientName} — ${r.burnPct}% burned`} className="flex items-center gap-2 text-label-small">
                  <span className="w-20 truncate text-m-on-surface-variant">{r.clientName}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-m-surface-container-high">
                    <span className={cn('block h-full rounded-full', burnBarColor[r.rag])} style={{ width: `${Math.min(r.burnPct, 100)}%` }} />
                  </span>
                  <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-m-on-surface">{r.burnPct}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Tile>

      <Tile title="Client touch" to="/clients" linkLabel="Clients">
        <Stat value={String(followUpsDue)} unit={`follow-up${followUpsDue !== 1 ? 's' : ''} due`} />
        <Sub>{contactedThisWeek} contacted this week</Sub>
        {dueClients.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {dueClients.slice(0, CHIP_LIMIT).map(c => (
              <span key={c.clientId} className="max-w-full truncate rounded-full bg-m-surface-container px-2 py-0.5 text-label-small text-m-on-surface-variant">
                {c.clientName}
              </span>
            ))}
            {dueClients.length > CHIP_LIMIT && (
              <span className="rounded-full bg-m-tertiary-container px-2 py-0.5 text-label-small font-semibold text-m-on-tertiary-container">
                +{dueClients.length - CHIP_LIMIT} more
              </span>
            )}
          </div>
        )}
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
        <div className="mt-2.5 flex h-9 items-end gap-1.5" aria-hidden="true">
          {WIP_STAGES.map((stage, idx) => {
            const count = wip.stages.find(s => s.stage === stage)?.count ?? 0
            return (
              <span
                key={stage}
                title={`${stage}: ${count}`}
                className={cn('block flex-1 rounded-t', wipStageColor(idx), count === 0 && 'opacity-25')}
                style={{ height: `${Math.max((count / maxStageCount) * 100, 6)}%` }}
              />
            )
          })}
        </div>
      </Tile>
    </div>
  )
}
