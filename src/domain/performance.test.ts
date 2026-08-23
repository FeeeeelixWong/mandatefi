import { describe, expect, it } from 'vitest'
import { buildPortfolioPerformance } from './performance'
import type { PancakeModuleReceipt } from '../types'

describe('portfolio performance', () => {
  it('projects term income from capital and model APY', () => {
    const performance = buildPortfolioPerformance({
      capitalStable: 100,
      durationDays: 30,
      estimatedApyBps: 626,
    })

    expect(performance.estimatedApyBps).toBe(626)
    expect(performance.projectedTermReturnBps).toBe(51)
    expect(performance.projectedTermIncomeStable).toBeCloseTo(0.51)
  })

  it('does not present open-position value as realized profit', () => {
    const performance = buildPortfolioPerformance({
      capitalStable: 100,
      durationDays: 30,
      estimatedApyBps: 626,
    })

    expect(performance.realized).toEqual({ state: 'NO_REALIZATION', amountStable: 0, returnBps: 0 })
  })

  it('requires cost-basis valuation after a confirmed exit', () => {
    const receipt: PancakeModuleReceipt = {
      id: 'exit-1', module: 'EARN', operation: 'WITHDRAW', state: 'CONFIRMED',
      createdAt: '2026-08-23T00:00:00.000Z', contract: '0x0000000000000000000000000000000000000001',
      note: 'Owner withdrew the position.',
    }
    const performance = buildPortfolioPerformance({
      capitalStable: 100,
      durationDays: 30,
      estimatedApyBps: 626,
      receipts: [receipt],
    })

    expect(performance.realized.state).toBe('VALUATION_REQUIRED')
    expect(performance.realized.amountStable).toBeNull()
  })
})
