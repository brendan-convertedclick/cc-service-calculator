import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LogTouchpointModal } from './LogTouchpointModal'
import { LimitedList } from './LimitedList'
import { useLogTouchpoint } from '@/hooks/usePulseClientHealth'
import type { ClientHealthRow } from '@/types/pulse'

const ragDot: Record<ClientHealthRow['rag'], string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-m-error',
}
const trendLabel: Record<ClientHealthRow['revenueTrend'], { text: string; cls: string }> = {
  up:   { text: '↑', cls: 'text-green-600 font-bold' },
  flat: { text: '→', cls: 'text-m-on-surface-variant' },
  down: { text: '↓', cls: 'text-m-error font-bold' },
}

interface Props {
  rows: ClientHealthRow[]
  onLogTouchpoint: (clientId: string) => void
}

export function ClientHealthSection({ rows, onLogTouchpoint }: Props) {
  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">
        Client Relationship Health
      </h2>
      <LimitedList
        items={rows}
        className="flex flex-col gap-2"
        renderItem={r => (
          <div key={r.clientId} className="flex items-center gap-3 rounded-lg bg-m-surface-container px-3 py-2.5">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', ragDot[r.rag])} />
            <span className="flex-1 text-body-small font-medium text-m-on-surface">{r.clientName}</span>
            <span className={cn('text-label-small', r.daysSinceContact > 21 ? 'text-amber-700 font-medium' : 'text-m-on-surface-variant')}>
              {r.lastTouchpointType ?? 'no contact'}{' '}
              {r.daysSinceContact < 999 ? `${r.daysSinceContact} days ago` : ''}
            </span>
            <span className={trendLabel[r.revenueTrend].cls}>{trendLabel[r.revenueTrend].text}</span>
            <Button variant="ghost" size="sm" className="px-2 text-label-small" onClick={() => onLogTouchpoint(r.clientId)}>
              Log
            </Button>
          </div>
        )}
      />
      <p className="mt-2 text-label-small text-m-on-surface-variant">
        Auto-tracked: inbound emails + paid invoices · Manual: log meetings and calls above
      </p>
    </section>
  )
}

export function ClientHealthSectionConnected({ rows }: { rows: ClientHealthRow[] }) {
  const [activeClientId, setActiveClientId] = useState<string | null>(null)
  const logTouchpoint = useLogTouchpoint()
  const activeClient = rows.find(r => r.clientId === activeClientId)

  return (
    <>
      <ClientHealthSection rows={rows} onLogTouchpoint={setActiveClientId} />
      {activeClient && (
        <LogTouchpointModal
          clientId={activeClient.clientId}
          clientName={activeClient.clientName}
          open={!!activeClientId}
          onClose={() => setActiveClientId(null)}
          onSubmit={payload => logTouchpoint.mutate(payload, { onSuccess: () => setActiveClientId(null) })}
          isPending={logTouchpoint.isPending}
        />
      )}
    </>
  )
}
