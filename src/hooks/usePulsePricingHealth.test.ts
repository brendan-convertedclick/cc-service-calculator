import { describe, it, expect } from 'vitest'
import { computePricingHealth } from './usePulsePricingHealth'

const projects = [
  { id: 'p1', client_id: 'c1', client_name: 'Acme', total_actual: 11, total_planned: 10 }, // 10% over → counts
  { id: 'p2', client_id: 'c1', client_name: 'Acme', total_actual: 9,  total_planned: 10 }, // under
  { id: 'p3', client_id: 'c2', client_name: 'Beta', total_actual: 8,  total_planned: 10 }, // under
]

describe('computePricingHealth', () => {
  it('calculates scope creep rate across all projects', () => {
    const { scopeCreepRate } = computePricingHealth(projects)
    expect(scopeCreepRate).toBe(33) // 1 of 3 = 33%
  })

  it('breaks down scope creep by client', () => {
    const { byClient } = computePricingHealth(projects)
    expect(byClient.find(c => c.clientId === 'c1')?.scopeCreepRate).toBe(50) // 1 of 2
    expect(byClient.find(c => c.clientId === 'c2')?.scopeCreepRate).toBe(0)
  })
})
