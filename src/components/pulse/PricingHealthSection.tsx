import { LimitedList } from './LimitedList'
import type { PricingHealthData } from '@/types/pulse'

export function PricingHealthSection({ data }: { data: PricingHealthData | null }) {
  if (!data) {
    return (
      <section>
        <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Pricing Health</h2>
        <p className="text-body-small text-m-on-surface-variant">No completed projects in the last 90 days.</p>
      </section>
    )
  }

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">Pricing Health</h2>
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <div className="font-mono text-headline-small font-semibold tabular-nums text-m-on-surface">{data.scopeCreepRate}%</div>
          <div className="mt-1 text-label-medium font-medium text-m-on-surface">Scope creep rate</div>
          <div className="text-label-small text-m-on-surface-variant">projects &gt;10% over quote</div>
        </div>
        <div>
          <div className="font-mono text-headline-small font-semibold tabular-nums text-m-on-surface">
            {data.conversionRate !== null ? `${data.conversionRate}%` : '—'}
          </div>
          <div className="mt-1 text-label-medium font-medium text-m-on-surface">Brief conversion</div>
          <div className="text-label-small text-m-on-surface-variant">brief → accepted quote</div>
        </div>
      </div>
      {data.byClient.length > 0 && (
        <div>
          <p className="mb-2 text-label-small font-semibold text-m-on-surface-variant">Scope creep by client (90 days)</p>
          <LimitedList
            items={data.byClient}
            className="flex flex-col gap-2"
            renderItem={c => (
              <div key={c.clientId} className="flex items-center gap-3">
                <span className="w-24 truncate text-body-small text-m-on-surface">{c.clientName}</span>
                <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-m-surface-container-high">
                  <div
                    className={c.scopeCreepRate > 20 ? 'h-full rounded-full bg-m-error' : 'h-full rounded-full bg-green-500'}
                    style={{ width: `${Math.min(c.scopeCreepRate, 100)}%` }}
                  />
                </div>
                <span className={`w-8 text-right text-label-small font-semibold ${c.scopeCreepRate > 20 ? 'text-m-error' : 'text-green-700'}`}>
                  {c.scopeCreepRate}%
                </span>
              </div>
            )}
          />
        </div>
      )}
    </section>
  )
}
