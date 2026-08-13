import { describe, it, expect, vi, beforeEach } from 'vitest'

type Insert = { table: string; rows: Record<string, unknown>[] }
const inserts: Insert[] = []

const mockFrom = vi.fn((table: string) => ({
  insert: (rows: Record<string, unknown>[]) => {
    inserts.push({ table, rows })
    const data = rows.map((r, i) => ({ id: `${table}-${i}`, title: r.title, ordinal: r.ordinal }))
    // Callers either await the insert directly or chain .select() — both work
    // on a real query builder, so both work here.
    return {
      select: () => Promise.resolve({ data, error: null }),
      then: (fn: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(fn),
    }
  },
}))

vi.mock('./supabase.js', () => ({ supabase: { from: mockFrom } }))
vi.mock('./lookup.js', () => ({
  resolveDepartment: (name: string) => Promise.resolve(`dept-${name.toLowerCase()}`),
  resolvePerson: (name: string) => Promise.resolve(`person-${name.toLowerCase()}`),
}))

import type { TaskInput } from './procedures.js'

const { writeTasks, resolveTasks } = await import('./procedures.js')

const ctx = { system_id: 'sys-1', service_id: null, owner_id: 'owner-default' }

/** Resolve then write — the order both tools call them in. */
async function write(tasks: TaskInput[], opts: Parameters<typeof writeTasks>[3]) {
  return writeTasks(ctx, tasks, await resolveTasks(tasks, ctx.owner_id), opts)
}

function rowsFor(table: string) {
  return inserts.filter((i) => i.table === table).flatMap((i) => i.rows)
}

describe('writeTasks', () => {
  beforeEach(() => {
    inserts.length = 0
    vi.clearAllMocks()
  })

  it('writes tasks as tasks and their steps as checklist items', async () => {
    await write([{ title: 'Brief the designer', department: 'Design', steps: [{ title: 'Read the scope' }] }], {
      startOrdinal: 1,
    })

    const [task, step] = rowsFor('process_steps')
    expect(task).toMatchObject({
      title: 'Brief the designer',
      parent_id: null,
      ordinal: 1,
      materialise_as: 'task',
      department_id: 'dept-design',
      owner_id: 'owner-default',
    })
    expect(step).toMatchObject({
      title: 'Read the scope',
      parent_id: 'process_steps-0',
      ordinal: 1,
      materialise_as: 'checklist_item',
    })
  })

  it('leaves hours to the steps when a task has any, and keeps them when it does not', async () => {
    await write(
      [
        { title: 'With steps', estimated_hours: 9, steps: [{ title: 'a', estimated_hours: 1 }] },
        { title: 'Without steps', estimated_hours: 2 },
      ],
      { startOrdinal: 1 },
    )

    const tasks = rowsFor('process_steps').filter((r) => r.parent_id === null)
    expect(tasks[0].estimated_hours).toBeNull()
    expect(tasks[1].estimated_hours).toBe(2)
  })

  it('chains consecutive tasks and lays them out left to right', async () => {
    await write([{ title: 'One' }, { title: 'Two' }, { title: 'Three' }], { startOrdinal: 1 })

    expect(rowsFor('system_edges')).toEqual([
      { system_id: 'sys-1', source_step_id: 'process_steps-0', target_step_id: 'process_steps-1' },
      { system_id: 'sys-1', source_step_id: 'process_steps-1', target_step_id: 'process_steps-2' },
    ])
    expect(rowsFor('process_steps').map((r) => r.pos_x)).toEqual([0, 280, 560])
  })

  it('hangs an appended task off the one before it', async () => {
    await write([{ title: 'Appended' }], { startOrdinal: 4, previousTaskId: 'existing-task', startX: 840 })

    expect(rowsFor('system_edges')).toEqual([
      { system_id: 'sys-1', source_step_id: 'existing-task', target_step_id: 'process_steps-0' },
    ])
    expect(rowsFor('process_steps')[0]).toMatchObject({ ordinal: 4, pos_x: 840 })
  })

  it('writes nothing at all for an empty task list', async () => {
    expect(await write([], { startOrdinal: 1 })).toEqual([])
    expect(inserts).toEqual([])
  })
})
