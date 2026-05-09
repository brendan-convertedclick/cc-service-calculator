import { Fragment } from 'react'
import { useSOWLevels } from '@/hooks/useSOWLevels'
import { useClauseSchema, useClauseValuesForLevel } from '@/hooks/useClauseValues'
import { ClauseCell } from './ClauseCell'
import type { ClauseSchema, SOWLevel } from '@/types/db'

interface Props {
  scopeIds: Record<string, string | null>
}

const sectionLabels: Record<string, string> = {
  commercial: 'Commercial',
  delivery:   'Delivery',
  scope:      'Scope',
  legal:      'Legal',
}

const sections = ['commercial', 'delivery', 'scope', 'legal'] as const

function levelTypeColor(type: SOWLevel['level_type']): string {
  return { agency: '#a5b4fc', service: '#6ee7b7', client: '#fca5a5', project: '#fdba74' }[type] ?? '#94a3b8'
}

export function ClauseTable({ scopeIds }: Props) {
  const { data: levels = [] } = useSOWLevels()
  const { data: schema = [] } = useClauseSchema()

  const bySection = sections.reduce((acc, s) => {
    acc[s] = schema.filter(c => c.section === s)
    return acc
  }, {} as Record<string, ClauseSchema[]>)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse min-w-[600px]">
        <thead>
          <tr className="bg-white/[0.04]">
            <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground w-44 sticky left-0 bg-background/95">
              Clause
            </th>
            {levels.map(l => (
              <th
                key={l.id}
                className="text-left px-2 py-2 text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                style={{ color: levelTypeColor(l.level_type) }}
              >
                {l.name}
              </th>
            ))}
            <th className="text-left px-3 py-2 text-xs font-semibold uppercase tracking-wider text-foreground whitespace-nowrap bg-white/[0.03]">
              Resolved ✓
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.map(section =>
            bySection[section].length > 0 ? (
              <Fragment key={`section-${section}`}>
                <tr className="bg-white/[0.02]">
                  <td
                    colSpan={levels.length + 2}
                    className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60"
                  >
                    {sectionLabels[section]}
                  </td>
                </tr>
                {bySection[section].map(clause => (
                  <ClauseRow
                    key={clause.key}
                    clause={clause}
                    levels={levels}
                    scopeIds={scopeIds}
                  />
                ))}
              </Fragment>
            ) : null
          )}
        </tbody>
      </table>
    </div>
  )
}

function ClauseRow({
  clause,
  levels,
  scopeIds,
}: {
  clause: ClauseSchema
  levels: SOWLevel[]
  scopeIds: Record<string, string | null>
}) {
  return (
    <tr className="border-t border-white/[0.04] hover:bg-white/[0.02]">
      <td className="px-3 py-1 text-xs text-muted-foreground sticky left-0 bg-background/95 w-44">
        <div className="font-medium text-foreground/80">{clause.label}</div>
        <div className="text-[10px] text-muted-foreground/60">{clause.merge_strategy}</div>
      </td>
      {levels.map(level => (
        <td key={level.id} className="px-0 py-0.5">
          <ClauseCellLoader
            clauseKey={clause.key}
            schema={clause}
            levelId={level.id}
            scopeId={scopeIds[level.id] ?? null}
          />
        </td>
      ))}
      <td className="px-3 py-1 text-xs bg-white/[0.03] text-muted-foreground">
        {/* Resolved column populated in SOWFamilyPage via resolved clauses query */}
      </td>
    </tr>
  )
}

function ClauseCellLoader({
  clauseKey,
  schema,
  levelId,
  scopeId,
}: {
  clauseKey: string
  schema: ClauseSchema
  levelId: string
  scopeId: string | null
}) {
  const { data: values = [] } = useClauseValuesForLevel(levelId, scopeId)
  const existing = values.find(v => v.clause_key === clauseKey)
  return (
    <ClauseCell
      clauseKey={clauseKey}
      schema={schema}
      levelId={levelId}
      scopeId={scopeId}
      existingValue={existing}
      inheritedDisplay={null}
      isResolved={false}
    />
  )
}
