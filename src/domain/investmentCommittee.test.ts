import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { buildInvestmentCommittee, type ExecutionCostEstimate } from './investmentCommittee'
import { buildPortfolioPlan } from './portfolio'
import { buildStrategyPlan } from './strategy'

const nowMs = Date.parse('2026-08-21T12:00:00.000Z')
const strategy = buildStrategyPlan({ goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly', horizonDays: 30 })

function context() {
  const snapshot = {
    nativeBalance: parseEther('0.0115'), stableBalance: 0n,
    priceStablePerNative: parseEther('500'), updatedAt: new Date(nowMs).toISOString(),
  }
  const executionPlan = buildPortfolioPlan({
    snapshot, managedAmount: parseEther('0.01'), goal: 'balanced-growth', risk: 'balanced', targetReserveBps: 2_500n,
  })
  return { snapshot, executionPlan }
}

describe('investment committee', () => {
  it('fails closed when a proposed trade has no fresh execution cost', () => {
    const committee = buildInvestmentCommittee({ nowMs, strategy, ...context() })
    expect(committee.costGatePassed).toBe(false)
    expect(committee.reports.find((report) => report.agentId === 'execution-cost')?.status).toBe('UNAVAILABLE')
  })

  it('accepts a route inside the mandate cost ceiling', () => {
    const executionCost: ExecutionCostEstimate = {
      observedAt: new Date(nowMs).toISOString(), gasPriceGwei: 1, gasUnits: 260_000,
      gasCostNative: '0.00026', gasCostBps: 260, slippageReserveBps: 100,
      priceImpactBps: 10, exitCostBps: 0, totalCostBps: 370,
      source: 'BSC_RPC_AND_PANCAKESWAP_QUOTE', note: 'Test estimate.',
    }
    const committee = buildInvestmentCommittee({ nowMs, strategy, ...context(), executionCost })
    expect(committee.costGatePassed).toBe(true)
    expect(committee.executionCostBps).toBe(370)
    expect(committee.readyAgents).toBe(2)
  })

  it('marks old market evidence stale', () => {
    const { executionPlan, snapshot } = context()
    const committee = buildInvestmentCommittee({
      nowMs, strategy, executionPlan,
      snapshot: { ...snapshot, updatedAt: new Date(nowMs - 16 * 60_000).toISOString() },
    })
    expect(committee.reports.find((report) => report.agentId === 'market')?.status).toBe('STALE')
  })
})
