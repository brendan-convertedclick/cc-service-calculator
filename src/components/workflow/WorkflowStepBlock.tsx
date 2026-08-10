import type { ProcessStepInstance } from '@/hooks/useWorkflowSteps'

type StepWithJoins = ProcessStepInstance & {
  department: { id: string; name: string; color: string } | null
  assignee: { id: string; full_name: string } | null
}

interface Props {
  step: StepWithJoins
}

const statusConfig = {
  done: {
    label: 'Done ✓',
    border: 'border-green-500/40',
    bg: 'bg-green-500/10',
    text: 'text-green-400',
  },
  in_progress: {
    label: 'Active ●',
    border: 'border-indigo-400/60 border-[1.5px]',
    bg: 'bg-indigo-500/15',
    text: 'text-indigo-300',
  },
  blocked: {
    label: 'Blocked',
    border: 'border-red-500/40',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
  },
  pending: {
    label: 'Pending',
    border: 'border-white/10 border-dashed',
    bg: 'bg-white/[0.02]',
    text: 'text-muted-foreground',
  },
  skipped: {
    label: 'Skipped',
    border: 'border-white/10 border-dashed',
    bg: 'bg-white/[0.02]',
    text: 'text-muted-foreground',
  },
}

function varianceColor(estimated: number | null, actual: number): string {
  if (!estimated || actual === 0) return 'text-green-400'
  const ratio = actual / estimated
  if (ratio <= 1.0) return 'text-green-400'
  if (ratio <= 1.2) return 'text-amber-400'
  return 'text-red-400'
}

type StepStatus = keyof typeof statusConfig

export function WorkflowStepBlock({ step }: Props) {
  const cfg = statusConfig[step.status as StepStatus]
  const isPending = step.status === 'pending' || step.status === 'skipped'
  const isDone = step.status === 'done'

  return (
    <div
      className={`
        flex-shrink-0 w-24 rounded-xl border p-2.5 text-center
        ${cfg.border} ${cfg.bg}
        ${isPending ? 'opacity-40' : ''}
      `}
    >
      <p className={`text-[9px] font-bold uppercase tracking-wide ${cfg.text} mb-0.5`}>
        {cfg.label}
      </p>
      <p className="text-[13px] font-semibold text-foreground leading-tight mb-0.5 truncate">
        {step.title}
      </p>
      {step.assignee && (
        <p className="text-[10px] text-muted-foreground truncate">
          {step.assignee.full_name.split(' ')[0]}
        </p>
      )}
      {isDone && (
        <p className={`text-[11px] font-semibold mt-1 ${varianceColor(step.estimated_hours, step.actual_hours)}`}>
          {step.actual_hours.toFixed(1)}h
          {step.estimated_hours && (
            <span className="text-[9px] opacity-70 ml-0.5">/ {step.estimated_hours}h</span>
          )}
        </p>
      )}
      {step.status === 'in_progress' && (
        <p className="text-[11px] text-indigo-300 font-semibold mt-1">
          {step.actual_hours.toFixed(1)}h…
          {step.estimated_hours && (
            <span className="text-[9px] opacity-70 ml-0.5">/ {step.estimated_hours}h</span>
          )}
        </p>
      )}
      {isPending && step.estimated_hours && (
        <p className="text-[11px] text-muted-foreground mt-1">est. {step.estimated_hours}h</p>
      )}
    </div>
  )
}
