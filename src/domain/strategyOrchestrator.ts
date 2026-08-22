import {
  ASSET_MANAGER_PROMPT_VERSION,
  buildAssetManagerPrompt,
  expertRecommendationSchema,
  type ExpertRecommendation,
} from './assetManagerPrompt'
import type { PortfolioPlan } from './portfolio'
import type { InvestmentCommittee } from './investmentCommittee'
import type { StrategyPlan } from './strategy'
import type { StablecoinSymbol } from '../lib/tokens'
import {
  evaluateTriggers,
  isCooldownActive,
  type ProtocolSignals,
  type ReviewSource,
  type ReviewTrigger,
} from './triggerEngine'

export type StrategyGateStatus = 'AUTO_EXECUTE' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'DEFERRED' | 'HOLD'

export type StrategyReview = {
  reviewNeeded: boolean
  source: ReviewSource
  prompt: string
  promptVersion: string
  modelMode: 'DEEPSEEK' | 'HYBRID_FALLBACK' | 'DETERMINISTIC_FALLBACK'
  modelName: string
  runId?: string
  inputHash?: string
  triggers: ReviewTrigger[]
  recommendation: ExpertRecommendation
  gate: {
    status: StrategyGateStatus
    checks: string[]
  }
  nextReviewAt: string
  committee?: InvestmentCommittee
}

export type StrategyOrchestratorContext = {
  source: ReviewSource
  nowMs?: number
  mandate: {
    goal: string
    riskProfile: string
    stablecoin: StablecoinSymbol
    managedAmount: string
    horizonDays: number
    liquidityNeed: string
    expiry: number
  }
  strategy: StrategyPlan
  executionPlan: PortfolioPlan
  lastReviewAt?: string
  lastExecutionAt?: string
  signals?: ProtocolSignals
  committee?: InvestmentCommittee
  recommendationOverride?: ExpertRecommendation
  modelMetadata?: {
    mode: StrategyReview['modelMode']
    modelName: string
    runId: string
    inputHash: string
  }
}

const adapterCoverage = {
  SWAP: 'LIVE',
  ADD_LIQUIDITY: 'APPROVAL_REQUIRED',
  REMOVE_LIQUIDITY: 'APPROVAL_REQUIRED',
  STAKE_FARM: 'APPROVAL_REQUIRED',
  UNSTAKE_FARM: 'APPROVAL_REQUIRED',
  HARVEST: 'ADAPTER_PLANNED',
  COMPOUND: 'ADAPTER_PLANNED',
  EMERGENCY_EXIT: 'APPROVAL_REQUIRED',
  PAUSE: 'OWNER_CONTROLLED',
  HOLD: 'NO_EXECUTION',
} as const

function deterministicRecommendation(triggers: ReviewTrigger[], plan: PortfolioPlan, committee?: InvestmentCommittee): ExpertRecommendation {
  const kinds = new Set(triggers.map((trigger) => trigger.kind))

  if (kinds.has('STABLECOIN_DEPEG')) {
    return { decision: 'PAUSE', action: 'PAUSE', confidence: 96, rationale: 'A reserve asset breached the depeg threshold. Pause automated allocation until the owner reviews replacement liquidity.', expectedNetBenefitBps: null, requiresApproval: true }
  }
  if (kinds.has('LIQUIDITY_DROP')) {
    return { decision: 'ADJUST', action: 'EMERGENCY_EXIT', confidence: 92, rationale: 'Exit liquidity deteriorated beyond the mandate threshold. Prepare an owner-approved emergency unwind.', expectedNetBenefitBps: null, requiresApproval: true }
  }
  if (kinds.has('MANDATE_EXPIRY')) {
    return { decision: 'PAUSE', action: 'PAUSE', confidence: 98, rationale: 'The mandate is at or near expiry. Stop new allocation changes until the owner renews or closes the strategy.', expectedNetBenefitBps: null, requiresApproval: true }
  }
  if (kinds.has('IMPERMANENT_LOSS') || kinds.has('LP_RANGE')) {
    return { decision: 'ADJUST', action: 'REMOVE_LIQUIDITY', confidence: 88, rationale: 'The LP position reached a mandate risk boundary. Remove or reposition liquidity after owner approval.', expectedNetBenefitBps: null, requiresApproval: true }
  }
  if (kinds.has('YIELD_DECAY')) {
    return { decision: 'ADJUST', action: 'UNSTAKE_FARM', confidence: 82, rationale: 'The current farm no longer clears the approved alternative after the yield-decay threshold.', expectedNetBenefitBps: 250, requiresApproval: true }
  }
  if (plan.action !== 'HOLD') {
    return {
      decision: 'ADJUST', action: 'SWAP', confidence: committee?.costGatePassed === false ? 72 : 90,
      rationale: committee ? `${plan.rationale} ${committee.summary}` : plan.rationale,
      expectedNetBenefitBps: committee?.netBenefitBps ?? null, requiresApproval: false,
    }
  }
  return { decision: 'HOLD', action: 'HOLD', confidence: 93, rationale: plan.rationale, expectedNetBenefitBps: 0, requiresApproval: false }
}

export function orchestrateStrategyReview(context: StrategyOrchestratorContext): StrategyReview {
  const nowMs = context.nowMs ?? Date.now()
  const triggerContext = {
    source: context.source,
    nowMs,
    strategy: context.strategy,
    executionPlan: context.executionPlan,
    lastReviewAt: context.lastReviewAt,
    lastExecutionAt: context.lastExecutionAt,
    expiry: context.mandate.expiry,
    signals: context.signals,
  }
  const triggers = evaluateTriggers(triggerContext)
  const reviewNeeded = triggers.length > 0
  const recommendation = expertRecommendationSchema.parse(
    reviewNeeded ? context.recommendationOverride ?? deterministicRecommendation(triggers, context.executionPlan, context.committee) : {
      decision: 'HOLD', action: 'HOLD', confidence: 100,
      rationale: 'No schedule, allocation, market, liquidity, cash-flow, or expiry trigger requires a strategy review.',
      expectedNetBenefitBps: 0, requiresApproval: false,
    },
  )
  const checks = [
    'Owner mandate is active and unexpired',
    'Action is constrained to a typed adapter',
    'Leverage and arbitrary calldata are blocked',
  ]

  let status: StrategyGateStatus = 'HOLD'
  const emergencyAction = recommendation.action === 'PAUSE' || recommendation.action === 'EMERGENCY_EXIT'
  if (context.mandate.expiry * 1_000 <= nowMs) {
    status = 'BLOCKED'
    checks.push('Mandate has expired')
  } else if (!reviewNeeded || recommendation.action === 'HOLD') {
    status = 'HOLD'
  } else if (!emergencyAction && context.executionPlan.purpose !== 'GAS_TOP_UP' && isCooldownActive(triggerContext)) {
    status = 'DEFERRED'
    checks.push(`Execution cooldown: ${context.strategy.guardrails.minimumActionCooldownMinutes} minutes`)
  } else if (recommendation.action === 'SWAP' && context.executionPlan.action !== 'HOLD' && context.executionPlan.purpose !== 'GAS_TOP_UP' && context.committee?.costGatePassed === false) {
    status = 'DEFERRED'
    checks.push(`Execution cost is missing, stale, or above the ${context.strategy.guardrails.maximumExecutionCostBps / 100}% mandate ceiling`)
  } else if (recommendation.action === 'SWAP' && context.executionPlan.action !== 'HOLD') {
    status = 'AUTO_EXECUTE'
    checks.push(context.executionPlan.purpose === 'GAS_TOP_UP'
      ? 'Bounded PancakeSwap Gas top-up route available'
      : 'Live PancakeSwap Swap adapter available')
    if (context.committee?.executionCostBps !== null && context.committee?.executionCostBps !== undefined) {
      checks.push(`Worst-case execution cost: ${context.committee.executionCostBps / 100}%`)
    }
  } else if (adapterCoverage[recommendation.action] === 'APPROVAL_REQUIRED' || adapterCoverage[recommendation.action] === 'OWNER_CONTROLLED') {
    status = 'APPROVAL_REQUIRED'
    checks.push('Explicit owner approval required before execution')
  } else {
    status = 'BLOCKED'
    checks.push('Execution adapter is not yet live')
  }

  const prompt = buildAssetManagerPrompt({
    mandate: context.mandate,
    strategy: context.strategy,
    executionPlan: context.executionPlan,
    activeTriggers: triggers.map((trigger) => trigger.kind),
    adapterCoverage,
    committee: context.committee,
  })

  return {
    reviewNeeded,
    source: context.source,
    prompt,
    promptVersion: ASSET_MANAGER_PROMPT_VERSION,
    modelMode: context.modelMetadata?.mode ?? 'DETERMINISTIC_FALLBACK',
    modelName: context.modelMetadata?.modelName ?? 'rules-engine',
    runId: context.modelMetadata?.runId,
    inputHash: context.modelMetadata?.inputHash,
    triggers,
    recommendation,
    gate: { status, checks },
    nextReviewAt: new Date(nowMs + context.strategy.reviewIntervalHours * 60 * 60 * 1_000).toISOString(),
    committee: context.committee,
  }
}
