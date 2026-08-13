import { describe, it, expect } from 'vitest'
import { matchByName } from './lookup.js'

const departments = [
  { id: 'd1', name: 'Design' },
  { id: 'd2', name: 'Development' },
  { id: 'd3', name: 'SEO & Content' },
]

describe('matchByName', () => {
  it('matches ignoring case and surrounding space', () => {
    expect(matchByName(departments, '  design ', 'department').id).toBe('d1')
  })

  it('matches on a unique fragment', () => {
    expect(matchByName(departments, 'seo', 'department').id).toBe('d3')
  })

  it('prefers an exact match over a longer name containing it', () => {
    const rows = [{ id: 'a', name: 'Ads' }, { id: 'b', name: 'Ads — Reporting' }]
    expect(matchByName(rows, 'Ads', 'department').id).toBe('a')
  })

  it('refuses an ambiguous fragment rather than guessing', () => {
    expect(() => matchByName(departments, 'de', 'department')).toThrow(/matches more than one/)
  })

  it('lists what is valid when nothing matches', () => {
    expect(() => matchByName(departments, 'Legal', 'department')).toThrow(
      /No department called "Legal".*Design, Development, SEO & Content/s,
    )
  })
})
