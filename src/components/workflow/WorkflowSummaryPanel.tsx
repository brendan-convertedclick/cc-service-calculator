import type { ProcessStepInstance, ProcessStepHandoff } from '@/hooks/useWorkflowSteps'

interface Props {
  steps: ProcessStepInstance[]
  handoffs: ProcessStepHandoff[]
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = Math.floor(hours / 24)
  const rem = Math.round(hours % 24)
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

export function WorkflowSummaryPanel({ steps, handoffs }: Props) {
  const done = steps.filter(s => s.status === 'done')
  const active = steps.find(s => s.status === 'in_progress')

  const estHours = done.reduce((sum, s) => sum + (s.estimated_hours ?? 0), 0)
  const actHours = done.reduce((sum, s) => sum + s.actual_hours, 0)
  const varianceH = actHours - estHours
  const variancePct = estHours > 0 ? Math.round((varianceH / estHours) * 100) : 0

  const totalHandoffH = handoffs.reduce((sum, h) => sum + h.handoff_hours, 0)
  const longestHandoff = handoffs.reduce<ProcessStepHandoff | null>(
    (max, h) => (!max || h.handoff_hours > max.handoff_hours ? h : max),
    null
  )

  const progressPct = steps.length > 0 ? Math.round((done.length / steps.length) * 100) : 0
  const totalCalendarH = actHours + totalHandoffH
  const waitingPct = totalCalendarH > 0 ? Math.round((totalHandoffH / totalCalendarH) * 100) : 0

  const varianceColor = varianceH <= 0
    ? 'text-green-400'
    : variancePct > 20
    ? 'text-red-400'
    : 'text-amber-400'

  return (
    <div className="flex flex-col gap-3 w-60 flex-shrink-0">
      {/* Progress */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
          Progress
        </p>
        <p className="text-2xl font-bold text-foreground leading-none">
          {done.length}{' '}
          <span className="text-sm font-normal text-muted-foreground">of {steps.length} steps</span>
        </p>
        <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-green-400 to-indigo-400 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {active && (
          <p className="mt-1.5 text-[11px] text-indigo-400">Step {active.ordinal} in progress</p>
        )}
      </div>

      {/* Execution time */}
      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
          Execution time
        </p>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-sm text-muted-foreground">Estimated</span>
          <span className="text-[15px] font-semibold text-foreground">{formatDuration(estHours)}</span>
        </div>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-sm text-muted-foreground">Actual</span>
          <span className={`text-[15px] font-semibold ${varianceH > 0 ? 'text-amber-400' : 'text-green-400'}`}>
            {formatDuration(actHours)}
          </span>
        </div>
        <div className="h-px bg-white/10 my-2" />
        <div className="flex justify-between">
          <span className="text-[11px] text-muted-foreground">Variance</span>
          <span className={`text-xs font-semibold ${varianceColor}`}>
            {varianceH >= 0 ? '+' : ''}{formatDuration(Math.abs(varianceH))} (
            {variancePct >= 0 ? '↑' : '↓'}{Math.abs(variancePct)}%)
          </span>
        </div>
      </div>

      {/* Handoff time */}
      {handoffs.length > 0 && (
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.08] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-1.5">
            Handoff time
          </p>
          <p className="text-2xl font-bold text-indigo-300 leading-none mb-2">
            {formatDuration(totalHandoffH)}
          </p>
          <div className="flex flex-col gap-1">
            {handoffs.map(h => (
              <div key={h.from_step_id} className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">{h.from_ordinal} → {h.from_ordinal + 1}</span>
                <span className={
                  h.handoff_hours > 24
                    ? 'text-red-400 font-semibold'
                    : h.handoff_hours > 4
                    ? 'text-amber-400'
                    : 'text-green-400'
                }>
                  {formatDuration(h.handoff_hours)}
                  {longestHandoff?.from_step_id === h.from_step_id && ' ← longest'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Calendar time */}
      {totalCalendarH > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Calendar time
          </p>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-muted-foreground">Working</span>
            <span className="text-foreground">{formatDuration(actHours)}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-muted-foreground">Waiting</span>
            <span className="text-indigo-300">{formatDuration(totalHandoffH)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden flex mb-1.5">
            <div className="h-full bg-green-400" style={{ width: `${100 - waitingPct}%` }} />
            <div className="h-full bg-indigo-500" style={{ width: `${waitingPct}%` }} />
          </div>
          <p className={`text-[11px] ${waitingPct > 50 ? 'text-red-400' : 'text-muted-foreground'}`}>
            {waitingPct}% of elapsed time is waiting
          </p>
        </div>
      )}
    </div>
  )
}
