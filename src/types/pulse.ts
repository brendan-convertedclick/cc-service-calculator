export interface RetainerBurnRow {
  projectId: string
  clientName: string
  feePerMonthCents: number
  hoursTarget: number
  hoursUsed: number
  burnPct: number
  daysLeftInMonth: number
  effectiveHourlyRateCents: number
  projectedHours: number
  isOverrunRisk: boolean
  isUnderutilised: boolean
  rag: 'green' | 'amber' | 'red'
}

export interface WipFunnelStage {
  stage: 'Received' | 'Scoping' | 'Quoted' | 'Accepted' | 'Delivered'
  count: number
  itemIds: string[]
}

export interface WipFunnelData {
  stages: WipFunnelStage[]
  conversionRate: number | null
  avgCycleDays: number | null
}

export interface ArAgingBand {
  band: '0-30' | '30-60' | '60+'
  totalCents: number
  invoices: Array<{
    id: string
    invoiceNumber: string | null
    clientName: string
    amountCents: number
    daysOverdue: number
  }>
}

export interface ClientHealthRow {
  clientId: string
  clientName: string
  daysSinceContact: number
  lastTouchpointType: 'meeting' | 'call' | 'email' | 'invoice' | null
  revenueTrend: 'up' | 'flat' | 'down'
  rag: 'green' | 'amber' | 'red'
}

export interface PricingHealthData {
  scopeCreepRate: number
  conversionRate: number | null
  byClient: Array<{
    clientId: string
    clientName: string
    scopeCreepRate: number
  }>
}

export interface RevenueTrendRow {
  clientId: string
  clientName: string
  months: Array<{ label: string; cents: number }>
  momChangePct: number | null
  thisMonthCents: number
  trend: 'up' | 'flat' | 'down'
}

export type PulseAlertLevel = 'overdue' | 'watch' | 'flag_am'

export interface PulseAlert {
  id: string
  level: PulseAlertLevel
  message: string
  linkTo: string
}
