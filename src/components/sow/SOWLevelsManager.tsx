import { useState } from 'react'
import { useSOWLevels, useReorderSOWLevels, useCreateSOWLevel, useDeleteSOWLevel } from '@/hooks/useSOWLevels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { SOWLevel } from '@/types/db'

const levelTypeColors: Record<SOWLevel['level_type'], string> = {
  agency:  'text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
  service: 'text-green-400 bg-green-500/10 border-green-500/25',
  client:  'text-red-400 bg-red-500/10 border-red-500/25',
  project: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
}

export function SOWLevelsManager() {
  const { data: levels = [] } = useSOWLevels()
  const reorder = useReorderSOWLevels()
  const create  = useCreateSOWLevel()
  const del     = useDeleteSOWLevel()

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<SOWLevel['level_type']>('service')

  async function moveUp(index: number) {
    if (index === 0) return
    const ids = levels.map(l => l.id)
    ;[ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]
    await reorder.mutateAsync(ids)
  }

  async function moveDown(index: number) {
    if (index === levels.length - 1) return
    const ids = levels.map(l => l.id)
    ;[ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]
    await reorder.mutateAsync(ids)
  }

  async function addLevel() {
    if (!newName.trim()) return
    const slug = newName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    await create.mutateAsync({
      name: newName.trim(),
      slug,
      level_type: newType,
      priority: (levels.at(-1)?.priority ?? 0) + 10,
    })
    setNewName('')
    setAdding(false)
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground mb-3">
        Use arrows to set priority order. Higher = more specific = overrides lower levels.
      </p>

      {levels.map((level, idx) => (
        <div
          key={level.id}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5"
        >
          <div className="flex flex-col gap-0.5 mr-1">
            <button
              onClick={() => moveUp(idx)}
              disabled={idx === 0}
              className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs leading-none"
            >▲</button>
            <button
              onClick={() => moveDown(idx)}
              disabled={idx === levels.length - 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-20 text-xs leading-none"
            >▼</button>
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">{level.name}</p>
            <p className="text-xs text-muted-foreground">{level.slug}</p>
          </div>
          <span className={`text-[10px] font-semibold border rounded-full px-2 py-0.5 ${levelTypeColors[level.level_type]}`}>
            {level.level_type}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-muted-foreground hover:text-red-400"
            onClick={() => del.mutate(level.id)}
          >
            ✕
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/[0.03] px-3 py-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Level name…"
            className="h-8 text-sm flex-1"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') addLevel()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <Select value={newType} onValueChange={v => setNewType(v as SOWLevel['level_type'])}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agency">agency</SelectItem>
              <SelectItem value="service">service</SelectItem>
              <SelectItem value="client">client</SelectItem>
              <SelectItem value="project">project</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" onClick={addLevel}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="w-full text-muted-foreground"
          onClick={() => setAdding(true)}
        >
          + Add level
        </Button>
      )}
    </div>
  )
}
