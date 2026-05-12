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
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="relative overflow-hidden rounded-lg border border-m-outline-variant bg-white p-3">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-brand" />
          <div className="text-display-small font-bold bg-gradient-brand bg-clip-text text-transparent">{data.scopeCreepRate}%</div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">Scope creep rate</div>
          <div className="mt-0.5 text-label-small text-m-on-surface-variant">projects &gt;10% over quote</div>
        </div>
        <div className="relative overflow-hidden rounded-lg border border-m-outline-variant bg-white p-3">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-brand" />
          <div className="text-display-small font-bold bg-gradient-brand bg-clip-text text-transparent">
            {data.conversionRate !== null ? `${data.conversionRate}%` : '—'}
          </div>
          <div className="mt-1 text-label-small font-semibold text-m-on-surface-variant">Brief conversion</div>
          <div className="mt-0.5 text-label-small text-m-on-surface-variant">brief → accepted quote</div>
        </div>
      </div>
      {data.byClient.length > 0 && (
        <div>
          <p className="mb-2 text-label-small font-semibold text-m-on-surface-variant">Scope creep by client (90 days)</p>
          <div className="flex flex-col gap-2">
            {data.byClient.map(c => (
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
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
