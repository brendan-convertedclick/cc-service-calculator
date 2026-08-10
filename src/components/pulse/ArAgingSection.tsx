import { Link } from 'react-router-dom'
import { formatZar as fmt } from '@/lib/utils'
import type { ArAgingBand } from '@/types/pulse'

const bandMeta: Record<ArAgingBand['band'], { label: string; bg: string; border: string; text: string; valueText: string }> = {
  '0-30':  { label: '0 – 30 days', bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', valueText: 'text-green-800' },
  '30-60': { label: '30 – 60 days', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', valueText: 'text-amber-800' },
  '60+':   { label: '60+ days', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', valueText: 'text-red-800' },
}

export function ArAgingSection({ bands }: { bands: ArAgingBand[] | null }) {
  if (!bands) {
    return (
      <section>
        <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">AR Aging</h2>
        <div className="rounded-lg border border-m-outline-variant bg-m-surface-container-low p-4 text-body-small text-m-on-surface-variant">
          <Link to="/settings?connect=xero" className="underline">Connect Xero</Link> to see AR aging.
        </div>
      </section>
    )
  }

  const total = bands.reduce((s, b) => s + b.totalCents, 0)

  return (
    <section>
      <h2 className="mb-3 text-label-small font-bold uppercase tracking-wide text-m-on-surface-variant">AR Aging</h2>
      <div className="grid grid-cols-3 gap-3 mb-3">
        {bands.map(b => {
          const m = bandMeta[b.band]
          return (
            <div key={b.band} className={`rounded-lg border p-3 text-center ${m.bg} ${m.border}`}>
              <div className={`font-mono text-title-large font-bold tabular-nums ${m.valueText}`}>{fmt(b.totalCents)}</div>
              <div className={`mt-1 text-label-small ${m.text}`}>{m.label}</div>
              <div className="mt-0.5 text-label-small text-m-on-surface-variant">{b.invoices.length} invoice{b.invoices.length !== 1 ? 's' : ''}</div>
            </div>
          )
        })}
      </div>
      <p className="text-body-small text-m-on-surface-variant">
        Total outstanding: <strong className="font-mono font-semibold tabular-nums text-m-on-surface">{fmt(total)}</strong>
      </p>
    </section>
  )
}
