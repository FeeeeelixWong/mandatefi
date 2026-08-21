import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import {
  deserializePortfolioPlan,
  serializePortfolioPlan,
  serializePortfolioSnapshot,
  specialistJudgementOutputSchema,
} from './agentContracts'
import { buildInvestmentCommittee } from './investmentCommittee'
import { buildPortfolioPlan } from './portfolio'
import { buildSpecialistPrompt, SPECIALIST_PROMPT_VERSION } from './specialistPrompts'
import { buildStrategyPlan } from './strategy'

const now = '2026-08-21T12:00:00.000Z'

function fixture() {
  const strategy = buildStrategyPlan({
    goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly', horizonDays: 30,
  })
  const snapshot = {
    nativeBalance: parseEther('0.0115'), stableBalance: 0n,
    stablecoin: 'USDT' as const,
    priceStablePerNative: parseEther('500'), updatedAt: now,
  }
  const executionPlan = buildPortfolioPlan({
    snapshot, managedAmount: parseEther('10'), goal: 'balanced-growth', risk: 'balanced',
    targetReserveBps: 2_500n,
  })
  const baseCommittee = buildInvestmentCommittee({
    nowMs: Date.parse(now), strategy, executionPlan, snapshot,
  })
  return { strategy, snapshot, executionPlan, baseCommittee }
}

describe('agent runtime contracts', () => {
  it('normalizes model confidence to an integer percentage', () => {
    const judgement = specialistJudgementOutputSchema.parse({
      stance: 'SUPPORT',
      confidence: 0.875,
      headline: 'Evidence supports the mandate.',
      findings: [],
      missingInputs: [],
    })
    expect(judgement.confidence).toBe(88)
  })

  it('round-trips every bigint portfolio field through JSON-safe strings', () => {
    const { executionPlan, snapshot } = fixture()
    const serialized = serializePortfolioPlan(executionPlan)
    expect(JSON.stringify(serialized)).not.toContain('BigInt')
    expect(deserializePortfolioPlan(serialized)).toEqual(executionPlan)
    expect(serializePortfolioSnapshot(snapshot).nativeBalance).toBe(snapshot.nativeBalance.toString())
  })

  it('builds a scoped prompt for each independent specialist', () => {
    const { strategy, snapshot, executionPlan, baseCommittee } = fixture()
    const marketReport = baseCommittee.reports.find((report) => report.agentId === 'market')
    if (!marketReport) throw new Error('Market report fixture missing.')
    const prompt = buildSpecialistPrompt('market', marketReport, {
      source: 'MANUAL',
      mandate: {
        goal: 'balanced-growth', riskProfile: 'balanced', stablecoin: 'USDT', managedAmount: '10',
        horizonDays: 30, liquidityNeed: 'weekly', expiry: 1_800_000_000,
      },
      strategy,
      executionPlan: serializePortfolioPlan(executionPlan),
      snapshot: serializePortfolioSnapshot(snapshot),
      activeTriggers: ['MANUAL'],
      baseCommittee,
      fallbackRecommendation: {
        decision: 'ADJUST', action: 'SWAP', confidence: 90,
        rationale: 'Reserve drift requires review.', expectedNetBenefitBps: null, requiresApproval: false,
      },
    })
    expect(SPECIALIST_PROMPT_VERSION).toBe('mandatefi.specialist.v1')
    expect(prompt.system).toContain('Market analyst')
    expect(prompt.system).toContain('Do not recommend a specific pool')
    expect(prompt.user).toContain('"activeTriggers"')
    expect(prompt.system).toContain('strict JSON')
  })
})
