import { supabase } from './supabase.js'

/** Where a Conductor record lives, so a tool can hand back a link a person can open. */
export const APP_URL = process.env.CONDUCTOR_APP_URL ?? 'https://conductor.convertedclick.co.za'

/**
 * Resolves a human-typed name to a row id.
 *
 * Every id in Conductor is a uuid, which is the one thing a model calling this
 * server will never have to hand — it has "Design" and "Brendan", not
 * `9f3c…`. So the write tools take names, and an unrecognised name comes back
 * as an error listing what *is* valid rather than a null the model has to
 * guess about.
 *
 * Matching is exact-ignoring-case first, then unique prefix/substring, so
 * "design" finds "Design" and "seo" finds "SEO & Content" — but an ambiguous
 * fragment is an error, never a coin toss.
 */
export function matchByName<T extends { id: string; name: string }>(
  rows: T[],
  wanted: string,
  label: string,
): T {
  const needle = wanted.trim().toLowerCase()
  const exact = rows.filter((r) => r.name.trim().toLowerCase() === needle)
  const hits = exact.length > 0 ? exact : rows.filter((r) => r.name.toLowerCase().includes(needle))

  if (hits.length === 1) return hits[0]
  const known = rows.map((r) => r.name).sort().join(', ')
  if (hits.length === 0) throw new Error(`No ${label} called "${wanted}". Known ${label}s: ${known}`)
  throw new Error(
    `"${wanted}" matches more than one ${label}: ${hits.map((h) => h.name).join(', ')}. Be more specific.`,
  )
}

async function fetchAll<T>(table: string, select: string, activeOnly: boolean): Promise<T[]> {
  let q = supabase.from(table).select(select)
  if (activeOnly) q = q.is('archived_at', null)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as T[]
}

/** Department id for a department name. A task can't reach ClickUp without one. */
export async function resolveDepartment(name: string): Promise<string> {
  const rows = await fetchAll<{ id: string; name: string }>('departments', 'id, name', true)
  return matchByName(rows, name, 'department').id
}

/** Team member id for a person's name or email address. */
export async function resolvePerson(nameOrEmail: string): Promise<string> {
  const rows = await fetchAll<{ id: string; name: string; email: string | null }>(
    'team_members',
    'id, name:full_name, email',
    true,
  )
  const needle = nameOrEmail.trim().toLowerCase()
  const byEmail = rows.find((r) => (r.email ?? '').toLowerCase() === needle)
  if (byEmail) return byEmail.id
  return matchByName(rows, nameOrEmail, 'team member').id
}

/** Service id for a service name — what a kind='service' procedure hangs off. */
export async function resolveService(name: string): Promise<string> {
  const { data, error } = await supabase.from('services').select('id, name').eq('status', 'active')
  if (error) throw new Error(error.message)
  return matchByName((data ?? []) as { id: string; name: string }[], name, 'service').id
}
