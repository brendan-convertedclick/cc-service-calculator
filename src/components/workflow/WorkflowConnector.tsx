interface Props {
  handoffHours: number | null
}

function formatHandoff(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const d = Math.floor(hours / 24)
  const h = Math.round(hours % 24)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

export function WorkflowConnector({ handoffHours }: Props) {
  if (handoffHours === null) {
    return (
      <div className="flex-shrink-0 w-11 flex flex-col items-center opacity-20">
        <div className="w-full h-0.5 bg-white/25" />
      </div>
    )
  }

  const isLong = handoffHours > 24
  const isMedium = handoffHours > 4

  const lineColor = isLong ? 'bg-red-500/70' : isMedium ? 'bg-amber-500/60' : 'bg-green-500/50'
  const labelBg = isLong ? 'bg-red-500/15' : isMedium ? 'bg-amber-500/15' : 'bg-green-500/10'
  const labelBorder = isLong ? 'border-red-500/40' : isMedium ? 'border-amber-500/35' : 'border-green-500/30'
  const labelText = isLong ? 'text-red-400' : isMedium ? 'text-amber-400' : 'text-green-400'

  return (
    <div className="flex-shrink-0 w-11 flex flex-col items-center gap-1">
      <div className={`w-full h-0.5 ${lineColor}`} />
      <div className={`border rounded-md px-1.5 py-px text-[9px] font-semibold ${labelBg} ${labelBorder} ${labelText} whitespace-nowrap`}>
        {formatHandoff(handoffHours)}
      </div>
    </div>
  )
}
