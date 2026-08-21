import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { buildPortfolioPlan } from './portfolio'
import { buildStrategyPlan } from './strategy'
import { orchestrateStrategyReview } from './strategyOrchestrator'
import { buildInvestmentCommittee, type ExecutionCostEstimate } from './investmentCommittee'

const nowMs = Date.parse('2026-08-21T12:00:00.000Z')
const strategy = buildStrategyPlan({ goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly', horizonDays: 30 })
const mandate = {
  goal: 'balanced-growth', riskProfile: 'balanced', stablecoin: 'USDT' as const, managedAmount: '10',
  horizonDays: 30, liquidityNeed: 'weekly', expiry: Math.floor(nowMs / 1_000) + 30 * 24 * 60 * 60,
}

function executionPlan(stableBalance: string) {
  return buildPortfolioPlan({
    snapshot: {
      nativeBalance: stableBalance === '0' ? parseEther('0.0115') : parseEther('0.009'),
      stableBalance: parseEther(stableBalance),
      stablecoin: 'USDT',
      priceStablePerNative: parseEther('500'),
      updatedAt: new Date(nowMs).toISOString(),
    },
    managedAmount: parseEther('10'), goal: 'balanced-growth', risk: 'balanced', targetReserveBps: 2_500n,
  })
}

describe('AI strategy orchestrator', () => {
  it('keeps the minute monitor idle when no trigger exists', () => {
    const review = orchestrateStrategyReview({
      source: 'MONITOR', nowMs, mandate, strategy, executionPlan: executionPlan('1.25'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
    })
    expect(review.reviewNeeded).toBe(false)
    expect(review.gate.status).toBe('HOLD')
  })

  it('lets a drift-triggered typed Swap pass the live adapter gate', () => {
    const review = orchestrateStrategyReview({
      source: 'MONITOR', nowMs, mandate, strategy, executionPlan: executionPlan('0'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
    })
    expect(review.recommendation.action).toBe('SWAP')
    expect(review.gate.status).toBe('AUTO_EXECUTE')
  })

  it('defers ordinary rebalancing during the mandate cooldown', () => {
    const review = orchestrateStrategyReview({
      source: 'MONITOR', nowMs, mandate, strategy, executionPlan: executionPlan('0'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      lastExecutionAt: new Date(nowMs - 30 * 60 * 1_000).toISOString(),
    })
    expect(review.gate.status).toBe('DEFERRED')
  })

  it('allows a bounded Gas refill to bypass the portfolio cooldown', () => {
    const gasPlan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.0005'), stableBalance: parseEther('10'),
        stablecoin: 'USDT', priceStablePerNative: parseEther('500'), updatedAt: new Date(nowMs).toISOString(),
      },
      managedAmount: parseEther('10'), goal: 'balanced-growth', risk: 'balanced', targetReserveBps: 2_500n,
    })
    const review = orchestrateStrategyReview({
      source: 'MONITOR', nowMs, mandate, strategy, executionPlan: gasPlan,
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      lastExecutionAt: new Date(nowMs - 30 * 60 * 1_000).toISOString(),
    })
    expect(gasPlan.purpose).toBe('GAS_TOP_UP')
    expect(review.gate.status).toBe('AUTO_EXECUTE')
  })

  it('requires owner approval for LP risk actions', () => {
    const review = orchestrateStrategyReview({
      source: 'MONITOR', nowMs, mandate, strategy, executionPlan: executionPlan('1.25'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      signals: { impermanentLossBps: 900 },
    })
    expect(review.recommendation.action).toBe('REMOVE_LIQUIDITY')
    expect(review.gate.status).toBe('APPROVAL_REQUIRED')
  })

  it('blocks every execution after the mandate expires', () => {
    const review = orchestrateStrategyReview({
      source: 'MONITOR', nowMs,
      mandate: { ...mandate, expiry: Math.floor(nowMs / 1_000) - 1 },
      strategy, executionPlan: executionPlan('0'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
    })
    expect(review.recommendation.action).toBe('PAUSE')
    expect(review.gate.status).toBe('BLOCKED')
  })

  it('builds a versioned prompt that forbids leverage and arbitrary calldata', () => {
    const review = orchestrateStrategyReview({ source: 'MANUAL', nowMs, mandate, strategy, executionPlan: executionPlan('1.25') })
    expect(review.promptVersion).toBe('mandatefi.asset-manager.v3')
    expect(review.prompt).toContain('Never use leverage')
    expect(review.prompt).toContain('arbitrary calldata')
    expect(review.prompt).toContain('opportunity discovery only')
    expect(review.prompt).toContain('Return strict JSON only')
  })

  it('defers a swap when the cost analyst rejects the route', () => {
    const plan = executionPlan('0')
    const executionCost: ExecutionCostEstimate = {
      observedAt: new Date(nowMs).toISOString(), gasPriceGwei: 3, gasUnits: 260_000,
      gasCostNative: '0.00078', gasCostBps: 780, slippageReserveBps: 100,
      priceImpactBps: 20, exitCostBps: 0, totalCostBps: 900,
      source: 'BSC_RPC_AND_PANCAKESWAP_QUOTE', note: 'Test estimate.',
    }
    const committee = buildInvestmentCommittee({
      nowMs, strategy, executionPlan: plan,
      snapshot: {
        nativeBalance: parseEther('0.0115'), stableBalance: 0n,
        stablecoin: 'USDT',
        priceStablePerNative: parseEther('500'), updatedAt: new Date(nowMs).toISOString(),
      },
      executionCost,
    })
    const review = orchestrateStrategyReview({ source: 'MANUAL', nowMs, mandate, strategy, executionPlan: plan, committee })
    expect(committee.costGatePassed).toBe(false)
    expect(review.gate.status).toBe('DEFERRED')
    expect(review.prompt).toContain('investmentCommittee')
  })

  it('keeps DeepSeek recommendations behind the deterministic adapter gate', () => {
    const review = orchestrateStrategyReview({
      source: 'MANUAL', nowMs, mandate, strategy, executionPlan: executionPlan('1.25'),
      recommendationOverride: {
        decision: 'ADJUST', action: 'ADD_LIQUIDITY', confidence: 91,
        rationale: 'Verified liquidity evidence supports a bounded LP allocation.',
        expectedNetBenefitBps: 180, requiresApproval: false,
      },
      modelMetadata: {
        mode: 'DEEPSEEK', modelName: 'deepseek-v4-pro', runId: 'run-1', inputHash: 'a'.repeat(64),
      },
    })
    expect(review.modelMode).toBe('DEEPSEEK')
    expect(review.modelName).toBe('deepseek-v4-pro')
    expect(review.gate.status).toBe('APPROVAL_REQUIRED')
  })

  it('blocks an expired mandate even when DeepSeek recommends execution', () => {
    const review = orchestrateStrategyReview({
      source: 'MANUAL', nowMs,
      mandate: { ...mandate, expiry: Math.floor(nowMs / 1_000) - 1 },
      strategy, executionPlan: executionPlan('0'),
      recommendationOverride: {
        decision: 'ADJUST', action: 'SWAP', confidence: 99,
        rationale: 'The model proposes a rebalance.', expectedNetBenefitBps: 500, requiresApproval: false,
      },
    })
    expect(review.gate.status).toBe('BLOCKED')
  })
})
