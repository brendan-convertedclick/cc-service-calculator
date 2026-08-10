// src/pages/Guides.tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, BarChart2, BarChart3, Bell, Boxes, Briefcase, Building2,
  CheckCircle2, ClipboardList, DollarSign, FileCheck, FileEdit, FilePlus,
  FileText, Filter, Flame, FolderKanban, GitBranch, GitMerge, Hammer,
  HeartPulse, HelpCircle, Inbox, ListChecks, Lock, Mail, Package, Paperclip,
  PhoneCall, Receipt, Repeat, RefreshCcw, RefreshCw, ScanSearch, Search,
  Send, SendHorizontal, Settings2, SlidersHorizontal, Sliders, Sparkles,
  TrendingUp, Users, Wand2, ChevronRight, ChevronDown, Lightbulb,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { decks, type Step } from '@/data/guides'

const iconMap: Record<string, React.ElementType> = {
  Activity, BarChart2, BarChart3, Bell, Boxes, Briefcase, Building2,
  CheckCircle2, ClipboardList, DollarSign, FileCheck, FileEdit, FilePlus,
  FileText, Filter, Flame, FolderKanban, GitBranch, GitMerge, Hammer,
  HeartPulse, HelpCircle, Inbox, ListChecks, Lock, Mail, Package, Paperclip,
  PhoneCall, Receipt, Repeat, RefreshCcw, RefreshCw, ScanSearch, Search,
  Send, SendHorizontal, Settings2, SlidersHorizontal, Sliders, Sparkles,
  TrendingUp, Users, Wand2,
}

function StepCard({
  step,
  index,
  expanded,
  onToggle,
}: {
  step: Step
  index: number
  expanded: boolean
  onToggle: () => void
}) {
  const navigate = useNavigate()

  return (
    <div
      className={`rounded-xl border bg-card transition-colors ${
        expanded ? 'border-primary' : 'border-border'
      }`}
    >
      <button
        type="button"
        className="flex w-full items-center gap-4 p-4 text-left"
        onClick={onToggle}
      >
        {(() => {
          const StepIcon = iconMap[step.icon]
          return (
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
              style={{
                background: `linear-gradient(135deg, ${step.gradient[0]}, ${step.gradient[1]})`,
              }}
            >
              {StepIcon ? <StepIcon className="h-[18px] w-[18px]" /> : <span className="text-sm font-bold">{index + 1}</span>}
            </div>
          )
        })()}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-foreground">{step.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{step.subtitle}</div>
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          ~{step.estMinutes} min
        </span>
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-0">
          <div
            className="mt-3 rounded-lg border-l-4 p-3"
            style={{
              background: `linear-gradient(135deg, ${step.gradient[0]}18, ${step.gradient[1]}18)`,
              borderLeftColor: step.gradient[0],
            }}
          >
            <div
              className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              style={{ color: step.gradient[0] }}
            >
              <Lightbulb className="h-3 w-3" />
              Why this matters
            </div>
            <p className="text-xs leading-relaxed text-foreground">{step.whyItMatters}</p>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Prerequisites
            </div>
            <ul className="list-disc pl-4 text-xs leading-relaxed text-muted-foreground">
              {step.prerequisites.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>

          <div className="mt-3">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Best-practice playbook
            </div>
            <ol className="list-decimal pl-4 text-xs leading-relaxed text-muted-foreground">
              {step.playbook.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
          </div>

          {step.actions.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {step.actions.map((action, i) => (
                <Button
                  key={i}
                  size="sm"
                  className="text-white"
                  style={{
                    background: `linear-gradient(135deg, ${step.gradient[0]}, ${step.gradient[1]})`,
                  }}
                  onClick={() => navigate(action.href)}
                >
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Guides() {
  const [activeDeckKey, setActiveDeckKey] = useState(decks[0].key)
  const [expandedStepKey, setExpandedStepKey] = useState<string | null>(null)

  const activeDeck = decks.find((d) => d.key === activeDeckKey) ?? decks[0]

  function handleDeckChange(key: string) {
    setActiveDeckKey(key)
    setExpandedStepKey(null)
  }

  function handleStepToggle(key: string) {
    setExpandedStepKey((prev) => (prev === key ? null : key))
  }

  return (
    <div className="container mx-auto max-w-6xl p-8">
      <h1 className="text-headline-medium text-m-on-surface">Guides</h1>
      <p className="mt-1 text-body-medium text-m-on-surface-variant">
        How everything works — step by step.
      </p>

      <div className="mt-6 flex gap-6">
        <div className="w-44 shrink-0 space-y-0.5 sticky top-0 self-start">
          {decks.map((deck) => {
            const Icon = iconMap[deck.icon]
            return (
              <button
                type="button"
                key={deck.key}
                onClick={() => handleDeckChange(deck.key)}
                className={`flex w-full items-center gap-2.5 rounded-md px-4 py-2.5 text-left text-label-large transition-colors ${
                  deck.key === activeDeckKey
                    ? 'bg-m-primary-container font-semibold text-m-on-primary-container'
                    : 'text-m-on-surface-variant hover:bg-m-surface-container hover:text-m-on-surface'
                }`}
              >
                {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
                {deck.label}
              </button>
            )
          })}
        </div>

        <div className="flex-1 space-y-2">
          {activeDeck.steps.map((step, i) => (
            <StepCard
              key={step.key}
              step={step}
              index={i}
              expanded={expandedStepKey === step.key}
              onToggle={() => handleStepToggle(step.key)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
