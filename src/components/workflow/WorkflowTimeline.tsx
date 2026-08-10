import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useWorkflowSteps, useWorkflowHandoffs } from '@/hooks/useWorkflowSteps'
import { WorkflowSummaryPanel } from './WorkflowSummaryPanel'
import { WorkflowStepBlock } from './WorkflowStepBlock'
import { WorkflowConnector } from './WorkflowConnector'
import { Button } from '@/components/ui/button'
import type { ProcessStepInstance } from '@/hooks/useWorkflowSteps'

interface Props {
  projectId: string
  projectName: string
}

type StepWithJoins = ProcessStepInstance & {
  department: { id: string; name: string; color: string } | null
  assignee: { id: string; full_name: string } | null
}

export function WorkflowTimeline({ projectId, projectName }: Props) {
  const { data: steps = [], isLoading } = useWorkflowSteps(projectId)
  const { data: handoffs = [] } = useWorkflowHandoffs(projectId)
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const activeStep = steps.find(s => s.status === 'in_progress')

  // Map handoff hours by from_ordinal for O(1) lookup
  const handoffMap = new Map(handoffs.map(h => [h.from_ordinal, h.handoff_hours]))

  async function handleSync() {
    setSyncing(true)
    try {
      await supabase.functions.invoke('sync-clickup-actuals', {
        body: { project_id: projectId },
      })
      qc.invalidateQueries({ queryKey: ['workflow-steps', projectId] })
      qc.invalidateQueries({ queryKey: ['workflow-handoffs', projectId] })
    } finally {
      setSyncing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading workflow…</div>
    )
  }

  if (steps.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No process steps defined for the services in this project.{' '}
        <Link to="/services" className="text-indigo-400 underline">
          Add steps to services
        </Link>{' '}
        to enable workflow tracking.
      </div>
    )
  }

  return (
    <div className="flex gap-4 p-4">
      {/* Left: summary panel */}
      <WorkflowSummaryPanel steps={steps} handoffs={handoffs} />

      {/* Right: timeline */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{projectName}</span>
            {activeStep && (
              <span className="bg-indigo-500/20 text-indigo-300 rounded-md px-2.5 py-0.5 text-[11px]">
                Step {activeStep.ordinal} in progress
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
            className="text-xs text-muted-foreground"
          >
            <RefreshCw className={`w-3 h-3 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            Sync now
          </Button>
        </div>

        {/* Horizontal step blocks */}
        <div className="flex items-center flex-wrap gap-y-3 overflow-x-auto pb-2">
          {steps.map((step, idx) => (
            <div key={step.id} className="flex items-center">
              <WorkflowStepBlock step={step as StepWithJoins} />
              {idx < steps.length - 1 && (
                <WorkflowConnector
                  handoffHours={handoffMap.get(step.ordinal) ?? null}
                />
              )}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-3 text-[10px] text-muted-foreground flex-wrap">
          <span>
            Blocks:{' '}
            <span className="text-green-400">■</span> under est{' '}
            <span className="text-amber-400 ml-1">■</span> slightly over{' '}
            <span className="text-red-400 ml-1">■</span> over
          </span>
          <span>
            Connectors:{' '}
            <span className="text-green-400">■</span> short wait{' '}
            <span className="text-red-400 ml-1">■</span> long wait
          </span>
        </div>
      </div>
    </div>
  )
}
