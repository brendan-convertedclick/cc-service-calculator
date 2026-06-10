import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { LimitedList } from './LimitedList'
import type { PulseAlert, PulseAlertLevel } from '@/types/pulse'

const GROUP_ORDER: PulseAlertLevel[] = ['overdue', 'watch', 'flag_am']

const groupMeta: Record<PulseAlertLevel, { label: (n: number) => string; dot: string; seg: string }> = {
  overdue: { label: () => 'overdue', dot: 'bg-m-error', seg: 'bg-m-error' },
  watch:   { label: () => 'to watch', dot: 'bg-amber-400', seg: 'bg-amber-400' },
  flag_am: { label: n => n === 1 ? 'follow-up' : 'follow-ups', dot: 'bg-m-tertiary', seg: 'bg-m-tertiary' },
}

const destinationLabels: Record<string, string> = {
  '/reconciliation': 'Reconciliation',
  '/projects': 'Projects',
  '/clients': 'Clients',
  '/retainers': 'Retainers',
}

function headline(counts: Record<PulseAlertLevel, number>) {
  if (counts.overdue > 0) {
    const urgent = `${counts.overdue} urgent ${counts.overdue === 1 ? 'item needs' : 'items need'} action.`
    const mostlyRoutine = counts.flag_am > counts.overdue + counts.watch
    return <>{mostlyRoutine && 'Mostly routine today — '}<strong className="font-semibold">{urgent}</strong></>
  }
  if (counts.watch > 0) return <>Nothing urgent — {counts.watch} worth watching.</>
  return <>All routine — follow-ups only.</>
}

/** Follow-up alerts all carry "Client — detail" messages; chips show just the client. */
const chipLabel = (message: string) => message.split(' — ')[0] || message

const CHIP_LIMIT = 8

export function AlertsStrip({ alerts }: { alerts: PulseAlert[] }) {
  const [open, setOpen] = useState<PulseAlertLevel | null>(null)
  const panelId = useId()
  // Stable item arrays so LimitedList's expand state survives parent re-renders.
  const groups = useMemo(() => GROUP_ORDER
    .map(level => ({ level, items: alerts.filter(a => a.level === level) }))
    .filter(g => g.items.length > 0), [alerts])

  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-3 text-body-small font-semibold text-green-800">
        ✓ All clear — no alerts today
      </div>
    )
  }
  const counts = Object.fromEntries(GROUP_ORDER.map(l => [l, 0])) as Record<PulseAlertLevel, number>
  groups.forEach(g => { counts[g.level] = g.items.length })

  const openGroup = groups.find(g => g.level === open)
  const toggle = (level: PulseAlertLevel) => setOpen(o => o === level ? null : level)

  return (
    <div className="rounded-xl border border-m-outline-variant bg-m-surface px-5 py-3 animate-in fade-in slide-in-from-bottom-1 duration-300">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-body-medium text-m-on-surface">
          <span className="mr-2.5 text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">Pulse</span>
          {headline(counts)}
        </p>
        <span className="shrink-0 text-label-small tabular-nums text-m-on-surface-variant">
          {alerts.length} signal{alerts.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="my-2 flex h-2.5 gap-0.5" aria-hidden="true">
        {groups.map(g => (
          <div
            key={g.level}
            title={`${g.items.length} ${groupMeta[g.level].label(g.items.length)}`}
            className={cn('min-w-6 rounded transition-all first:rounded-l-full last:rounded-r-full', groupMeta[g.level].seg)}
            style={{ flexGrow: g.items.length }}
          />
        ))}
      </div>

      <div className="-mx-2.5 flex flex-wrap items-center gap-1.5">
        {groups.map(g => (
          <button
            key={g.level}
            type="button"
            aria-expanded={open === g.level}
            aria-controls={panelId}
            onClick={() => toggle(g.level)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-0.5 transition-colors hover:bg-m-surface-container',
              open === g.level && 'border-m-outline-variant bg-m-surface-container-high',
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', groupMeta[g.level].dot)} />
            <span className="text-body-small font-semibold tabular-nums text-m-on-surface">{g.items.length}</span>
            <span className="text-body-small text-m-on-surface-variant">{groupMeta[g.level].label(g.items.length)}</span>
            <ChevronDown className={cn('h-3 w-3 text-m-on-surface-variant transition-transform', open === g.level && 'rotate-180')} />
          </button>
        ))}
      </div>

      <div id={panelId} className={cn('grid transition-[grid-template-rows] duration-300', openGroup ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          {openGroup && (
            <div className="mt-2.5 border-t border-m-outline-variant pt-3">
              <div className="mb-1.5 flex items-baseline justify-between gap-3 px-1.5">
                <span className="text-label-small font-semibold uppercase tracking-wide text-m-on-surface-variant">
                  {openGroup.items.length} {groupMeta[openGroup.level].label(openGroup.items.length)}
                </span>
                {/* Only meaningful when the whole group shares a destination; rows always deep-link. */}
                {new Set(openGroup.items.map(a => a.linkTo)).size === 1 && (
                  <Link to={openGroup.items[0].linkTo} className="shrink-0 text-label-small font-medium text-m-primary hover:underline">
                    Open {destinationLabels[openGroup.items[0].linkTo] ?? 'page'} →
                  </Link>
                )}
              </div>
              {openGroup.level === 'flag_am' ? (
                <div className="flex flex-wrap gap-1.5 px-1.5 pb-1">
                  {openGroup.items.slice(0, CHIP_LIMIT).map(a => (
                    <Link
                      key={a.id}
                      to={a.linkTo}
                      title={a.message}
                      className="rounded-full border border-m-outline-variant bg-m-surface-container px-2.5 py-1 text-label-small font-medium text-m-on-surface transition-colors hover:bg-m-surface-container-high"
                    >
                      {chipLabel(a.message)}
                    </Link>
                  ))}
                  {openGroup.items.length > CHIP_LIMIT && (
                    <Link
                      to={openGroup.items[0].linkTo}
                      className="rounded-full bg-m-tertiary-container px-2.5 py-1 text-label-small font-semibold text-m-on-tertiary-container"
                    >
                      +{openGroup.items.length - CHIP_LIMIT} more →
                    </Link>
                  )}
                </div>
              ) : (
                <LimitedList
                  items={openGroup.items}
                  limit={6}
                  className="flex flex-col"
                  renderItem={a => (
                    <Link
                      key={a.id}
                      to={a.linkTo}
                      className="group flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-m-surface-container"
                    >
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', groupMeta[openGroup.level].dot)} />
                      <span className="min-w-0 flex-1 truncate text-body-small text-m-on-surface">{a.message}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-m-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>
                  )}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
