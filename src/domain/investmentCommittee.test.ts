import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { buildInvestmentCommittee, type ExecutionCostEstimate } from './investmentCommittee'
import { buildPortfolioPlan } from './portfolio'
import { buildStrategyPlan } from './strategy'
import type { PancakeMarketSnapshot } from '../integrations/pancakeMarket'

const nowMs = Date.parse('2026-08-21T12:00:00.000Z')
const strategy = buildStrategyPlan({ goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly', horizonDays: 30 })
const pancakeMarket: PancakeMarketSnapshot = {
  provider: 'PancakeSwap Price API SDK', sdkVersion: '11.1.1', chainId: 56,
  observedAt: new Date(nowMs).toISOString(),
  pricesUsd: { bnb: 680, cake: 1.74, usdt: 0.9998, usdc: 1.0001 },
  stablecoinMaxDeviationBps: 2,
  sourceUrl: 'https://developer.pancakeswap.finance/sdks/price-api-sdk',
}

function context() {
  const snapshot = {
    nativeBalance: parseEther('0.0115'), stableBalance: 0n,
    stablecoin: 'USDT' as const,
    priceStablePerNative: parseEther('500'), updatedAt: new Date(nowMs).toISOString(),
  }
  const executionPlan = buildPortfolioPlan({
    snapshot, managedAmount: parseEther('10'), goal: 'balanced-growth', risk: 'balanced', targetReserveBps: 2_500n,
  })
  return { snapshot, executionPlan, pancakeMarket }
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
    const { executionPlan, snapshot, pancakeMarket } = context()
    const committee = buildInvestmentCommittee({
      nowMs, strategy, executionPlan, pancakeMarket,
      snapshot: { ...snapshot, updatedAt: new Date(nowMs - 16 * 60_000).toISOString() },
    })
    expect(committee.reports.find((report) => report.agentId === 'market')?.status).toBe('STALE')
  })

  it('fails closed when the official PancakeSwap Price API snapshot is missing', () => {
    const { executionPlan, snapshot } = context()
    const executionCost: ExecutionCostEstimate = {
      observedAt: new Date(nowMs).toISOString(), gasPriceGwei: 1, gasUnits: 260_000,
      gasCostNative: '0.00026', gasCostBps: 260, slippageReserveBps: 100,
      priceImpactBps: 10, exitCostBps: 0, totalCostBps: 370,
      source: 'BSC_RPC_AND_PANCAKESWAP_QUOTE', note: 'Test estimate.',
    }
    const committee = buildInvestmentCommittee({ nowMs, strategy, executionPlan, snapshot, executionCost })
    const marketReport = committee.reports.find((report) => report.agentId === 'market')
    expect(marketReport?.status).toBe('UNAVAILABLE')
    expect(marketReport?.missingInputs[0]).toContain('Price API SDK')
    expect(committee.costGatePassed).toBe(false)
  })

  it('blocks execution when a stablecoin deviates by at least one percent', () => {
    const executionCost: ExecutionCostEstimate = {
      observedAt: new Date(nowMs).toISOString(), gasPriceGwei: 1, gasUnits: 260_000,
      gasCostNative: '0.00026', gasCostBps: 260, slippageReserveBps: 100,
      priceImpactBps: 10, exitCostBps: 0, totalCostBps: 370,
      source: 'BSC_RPC_AND_PANCAKESWAP_QUOTE', note: 'Test estimate.',
    }
    const committee = buildInvestmentCommittee({
      nowMs, strategy, ...context(), executionCost,
      pancakeMarket: { ...pancakeMarket, pricesUsd: { ...pancakeMarket.pricesUsd, usdt: 0.98 }, stablecoinMaxDeviationBps: 200 },
    })
    expect(committee.reports.find((report) => report.agentId === 'market')?.stance).toBe('BLOCK')
    expect(committee.costGatePassed).toBe(false)
  })
})
