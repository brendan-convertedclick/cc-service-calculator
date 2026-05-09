import { useState } from 'react'
import type { ClauseSchema, ClauseValue } from '@/types/db'
import { useUpsertClauseValue, useDeleteClauseValue } from '@/hooks/useClauseValues'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface Props {
  clauseKey: string
  schema: ClauseSchema
  levelId: string
  scopeId: string | null
  existingValue: ClauseValue | undefined
  inheritedDisplay: string | null
  isResolved: boolean
}

export function ClauseCell({
  clauseKey, schema, levelId, scopeId,
  existingValue, inheritedDisplay, isResolved,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const upsert = useUpsertClauseValue()
  const del = useDeleteClauseValue()

  const hasValue = Boolean(existingValue)

  function displayValue(): string {
    if (!existingValue) return ''
    if (schema.value_type === 'number') return String(existingValue.value_number ?? '')
    if (schema.value_type === 'boolean') return String(existingValue.value_bool ?? '')
    if (schema.value_type === 'string[]') {
      try { return JSON.parse(existingValue.value_text ?? '[]').join(', ') }
      catch { return existingValue.value_text ?? '' }
    }
    return existingValue.value_text ?? ''
  }

  function startEdit() {
    setDraft(displayValue())
    setEditing(true)
  }

  async function save() {
    const payload: Omit<ClauseValue, 'id' | 'updated_at'> = {
      clause_key: clauseKey,
      level_id: levelId,
      scope_id: scopeId,
      value_text: null,
      value_number: null,
      value_bool: null,
    }
    if (schema.value_type === 'number') {
      payload.value_number = parseFloat(draft)
    } else if (schema.value_type === 'boolean') {
      payload.value_bool = draft === 'true'
    } else if (schema.value_type === 'string[]') {
      payload.value_text = JSON.stringify(
        draft.split(',').map(s => s.trim()).filter(Boolean)
      )
    } else {
      payload.value_text = draft
    }
    await upsert.mutateAsync(payload)
    setEditing(false)
  }

  async function clear() {
    if (existingValue?.id) await del.mutateAsync(existingValue.id)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 p-1">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="h-7 text-xs"
          placeholder={schema.value_type === 'string[]' ? 'item1, item2' : 'Enter value…'}
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={save}>✓</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => setEditing(false)}>✕</Button>
      </div>
    )
  }

  if (!hasValue) {
    return (
      <div
        className="px-2 py-1.5 text-xs text-muted-foreground/50 italic cursor-pointer hover:bg-white/5 rounded transition-colors min-h-[32px] flex items-center"
        onClick={startEdit}
        title="Click to set value at this level"
      >
        {inheritedDisplay ? `(${inheritedDisplay})` : '—'}
      </div>
    )
  }

  return (
    <div
      className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-white/5 rounded transition-colors min-h-[32px] flex items-center justify-between group ${
        isResolved ? 'font-semibold text-foreground' : 'text-muted-foreground'
      }`}
      onClick={startEdit}
    >
      <span className="truncate">{displayValue()}</span>
      <Button
        size="sm"
        variant="ghost"
        className="h-5 px-1 text-[10px] opacity-0 group-hover:opacity-100 text-muted-foreground ml-1 flex-shrink-0"
        onClick={e => { e.stopPropagation(); clear() }}
        title="Clear this override"
      >
        ✕
      </Button>
    </div>
  )
}
