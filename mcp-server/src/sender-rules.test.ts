import { describe, it, expect } from 'vitest'
import { evaluatePattern, decide } from './sender-rules.js'

describe('evaluatePattern', () => {
  it('matches exact email case-insensitively', () => {
    expect(evaluatePattern('gregh@x.com', 'GregH@X.com')).toBe(true)
  })
  it('matches *@domain wildcard', () => {
    expect(evaluatePattern('*@x.com', 'anyone@x.com')).toBe(true)
    expect(evaluatePattern('*@x.com', 'anyone@y.com')).toBe(false)
  })
  it('rejects malformed pattern without @', () => {
    expect(evaluatePattern('x.com', 'a@x.com')).toBe(false)
  })
  it('exact mismatch returns false', () => {
    expect(evaluatePattern('a@x.com', 'b@x.com')).toBe(false)
  })
})

describe('decide', () => {
  const rules = [
    { id: 'r1', pattern: '*@x.com', mode: 'allow' as const },
    { id: 'r2', pattern: 'greg@x.com', mode: 'block' as const },
  ]
  it('block beats allow', () => {
    expect(decide('greg@x.com', rules)).toEqual({ decision: 'block', rule_id: 'r2' })
  })
  it('falls through to allow when no block matches', () => {
    expect(decide('sam@x.com', rules)).toEqual({ decision: 'allow', rule_id: 'r1' })
  })
  it('returns pending when no rule matches', () => {
    expect(decide('new@x.com', [])).toEqual({ decision: 'pending' })
  })
})
