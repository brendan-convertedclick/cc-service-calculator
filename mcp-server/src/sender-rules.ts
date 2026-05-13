export type RuleMode = 'allow' | 'block'
export interface Rule { id: string; pattern: string; mode: RuleMode }
export type Decision =
  | { decision: 'allow'; rule_id: string }
  | { decision: 'block'; rule_id: string }
  | { decision: 'pending' }

export function evaluatePattern(pattern: string, email: string): boolean {
  const p = pattern.trim().toLowerCase()
  const e = email.trim().toLowerCase()
  if (p.startsWith('*@')) return e.endsWith(p.slice(1))
  if (!p.includes('@')) return false
  return p === e
}

export function decide(email: string, rules: Rule[]): Decision {
  const block = rules.find(r => r.mode === 'block' && evaluatePattern(r.pattern, email))
  if (block) return { decision: 'block', rule_id: block.id }
  const allow = rules.find(r => r.mode === 'allow' && evaluatePattern(r.pattern, email))
  if (allow) return { decision: 'allow', rule_id: allow.id }
  return { decision: 'pending' }
}
