import type { PortfolioPlan } from './portfolio'
import type { StrategyPlan } from './strategy'

export type ReviewSource = 'ACTIVATION' | 'MANUAL' | 'MONITOR'
export type TriggerKind =
  | 'ACTIVATION'
  | 'MANUAL'
  | 'SCHEDULE_DUE'
  | 'PORTFOLIO_DRIFT'
  | 'LP_RANGE'
  | 'IMPERMANENT_LOSS'
  | 'YIELD_DECAY'
  | 'LIQUIDITY_DROP'
  | 'STABLECOIN_DEPEG'
  | 'CASH_FLOW'
  | 'MANDATE_EXPIRY'

export type TriggerSeverity = 'info' | 'warning' | 'critical'

export type ReviewTrigger = {
  kind: TriggerKind
  severity: TriggerSeverity
  label: string
  detail: string
}

export type ProtocolSignals = {
  lpRangeDistanceBps?: number
  impermanentLossBps?: number
  currentNetYieldBps?: number
  bestAlternativeNetYieldBps?: number
  liquidityChangeBps?: number
  stablecoinDeviationBps?: number
  cashFlowDetected?: boolean
  liquidityObservedAt?: string
  lpFeeAprBps?: number
  farmObservedAt?: string
  farmRiskCostBps?: number
  earnObservedAt?: string
  earnNetYieldBps?: number
  earnRiskCostBps?: number
  pendingRewardsValueBps?: number
}

export type TriggerContext = {
  source: ReviewSource
  nowMs: number
  strategy: StrategyPlan
  executionPlan: PortfolioPlan
  lastReviewAt?: string
  lastExecutionAt?: string
  expiry: number
  signals?: ProtocolSignals
}

const hourMs = 60 * 60 * 1_000
const daySeconds = 24 * 60 * 60

export function isCooldownActive(context: Pick<TriggerContext, 'nowMs' | 'lastExecutionAt' | 'strategy'>) {
  if (!context.lastExecutionAt) return false
  const lastExecutionMs = Date.parse(context.lastExecutionAt)
  if (!Number.isFinite(lastExecutionMs)) return false
  return context.nowMs - lastExecutionMs < context.strategy.guardrails.minimumActionCooldownMinutes * 60_000
}

export function evaluateTriggers(context: TriggerContext): ReviewTrigger[] {
  const triggers: ReviewTrigger[] = []
  const signals = context.signals ?? {}

  if (context.source === 'ACTIVATION') {
    triggers.push({ kind: 'ACTIVATION', severity: 'info', label: 'Strategy activation', detail: 'Run the first portfolio review before activating execution.' })
  } else if (context.source === 'MANUAL') {
    triggers.push({ kind: 'MANUAL', severity: 'info', label: 'Owner review', detail: 'The owner requested an immediate strategy review.' })
  } else {
    const lastReviewMs = context.lastReviewAt ? Date.parse(context.lastReviewAt) : Number.NaN
    const reviewDue = !Number.isFinite(lastReviewMs) || context.nowMs - lastReviewMs >= context.strategy.reviewIntervalHours * hourMs
    if (reviewDue) {
      triggers.push({ kind: 'SCHEDULE_DUE', severity: 'info', label: 'Scheduled review', detail: `${context.strategy.reviewCadence} review interval has elapsed.` })
    }
  }

  if (context.executionPlan.action !== 'HOLD') {
    triggers.push({ kind: 'PORTFOLIO_DRIFT', severity: 'warning', label: 'Allocation drift', detail: 'The liquid reserve is outside its owner-approved execution band.' })
  }
  if (signals.lpRangeDistanceBps !== undefined && signals.lpRangeDistanceBps <= 300) {
    triggers.push({ kind: 'LP_RANGE', severity: 'warning', label: 'LP range edge', detail: 'A concentrated-liquidity position is within 3% of its active range boundary.' })
  }
  if (signals.impermanentLossBps !== undefined && signals.impermanentLossBps > context.strategy.guardrails.maximumImpermanentLossBps) {
    triggers.push({ kind: 'IMPERMANENT_LOSS', severity: 'critical', label: 'IL limit exceeded', detail: 'Estimated impermanent loss exceeds the mandate limit.' })
  }
  if (
    signals.currentNetYieldBps !== undefined &&
    signals.bestAlternativeNetYieldBps !== undefined &&
    signals.bestAlternativeNetYieldBps - signals.currentNetYieldBps >= 250
  ) {
    triggers.push({ kind: 'YIELD_DECAY', severity: 'warning', label: 'Yield opportunity changed', detail: 'An approved alternative exceeds the current net yield by at least 2.5%.' })
  }
  if (signals.liquidityChangeBps !== undefined && signals.liquidityChangeBps <= -2_500) {
    triggers.push({ kind: 'LIQUIDITY_DROP', severity: 'critical', label: 'Liquidity dropped', detail: 'Position exit liquidity fell by at least 25% since the prior review.' })
  }
  if (signals.stablecoinDeviationBps !== undefined && Math.abs(signals.stablecoinDeviationBps) >= 100) {
    triggers.push({ kind: 'STABLECOIN_DEPEG', severity: 'critical', label: 'Stablecoin depeg', detail: 'A reserve asset moved at least 1% away from its reference price.' })
  }
  if (signals.cashFlowDetected) {
    triggers.push({ kind: 'CASH_FLOW', severity: 'info', label: 'Wallet cash flow', detail: 'A deposit or withdrawal changed the managed portfolio.' })
  }
  if (context.expiry - Math.floor(context.nowMs / 1_000) <= 2 * daySeconds) {
    triggers.push({ kind: 'MANDATE_EXPIRY', severity: 'warning', label: 'Mandate expiry', detail: 'The owner mandate expires within 48 hours.' })
  }

  return triggers
}
