import { describe, it, expect } from 'vitest'
import { normalizeHost, hostMatches } from './domain.js'

describe('normalizeHost', () => {
  it('returns empty for nullish input', () => {
    expect(normalizeHost(null)).toBe('')
    expect(normalizeHost(undefined)).toBe('')
    expect(normalizeHost('')).toBe('')
  })

  it('passes through a bare host', () => {
    expect(normalizeHost('trellidor.co.za')).toBe('trellidor.co.za')
  })

  it('strips scheme, www, path, trailing slash, and port', () => {
    expect(normalizeHost('https://trellidor.co.za/')).toBe('trellidor.co.za')
    expect(normalizeHost('http://www.trellidor.co.za/some/path')).toBe('trellidor.co.za')
    expect(normalizeHost('HTTPS://Trellidor.CO.ZA')).toBe('trellidor.co.za')
    expect(normalizeHost('localhost:3000/x')).toBe('localhost')
    expect(normalizeHost('  https://trellidor.co.uk/ ')).toBe('trellidor.co.uk')
  })
})

describe('hostMatches', () => {
  it('matches exact host', () => {
    expect(hostMatches('trellidor.co.za', 'trellidor.co.za')).toBe(true)
  })

  it('matches a subdomain of the client host', () => {
    expect(hostMatches('mail.trellidor.co.za', 'trellidor.co.za')).toBe(true)
  })

  it('does not match a different host', () => {
    expect(hostMatches('trellidoruk.com', 'trellidor.co.za')).toBe(false)
  })

  it('does not match a suffix that is not a dot-boundary subdomain', () => {
    expect(hostMatches('nottrellidor.co.za', 'trellidor.co.za')).toBe(false)
  })

  it('returns false for empty inputs', () => {
    expect(hostMatches('', 'trellidor.co.za')).toBe(false)
    expect(hostMatches('trellidor.co.za', '')).toBe(false)
  })
})
