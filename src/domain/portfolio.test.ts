import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { buildPortfolioPlan, targetStableBpsFor } from './portfolio'

const now = '2026-08-20T00:00:00.000Z'

describe('portfolio policy engine', () => {
  it('combines goal and risk into a deterministic stable target', () => {
    expect(targetStableBpsFor('preserve', 'conservative')).toBe(8_000n)
    expect(targetStableBpsFor('balanced-growth', 'balanced')).toBe(4_500n)
    expect(targetStableBpsFor('maximize-growth', 'growth')).toBe(1_000n)
  })

  it('buys BUSD when stable exposure is below the policy band', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.0115'),
        stableBalance: 0n,
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('0.01'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })

    expect(plan.action).toBe('BUY_STABLE')
    expect(plan.amountIn).toBe(parseEther('0.0035'))
    expect(plan.projectedStableBps).toBe(3_500n)
  })

  it('holds when allocation remains inside the allowed drift band', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.007'),
        stableBalance: parseEther('2.25'),
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('0.01'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })

    expect(plan.currentStableBps).toBe(4_500n)
    expect(plan.action).toBe('HOLD')
    expect(plan.amountIn).toBe(0n)
  })

  it('buys tBNB when the stable allocation exceeds its upper band', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.0035'),
        stableBalance: parseEther('4'),
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('0.01'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })

    expect(plan.action).toBe('BUY_NATIVE')
    expect(plan.amountIn).toBe(parseEther('1.75'))
    expect(plan.projectedStableBps).toBe(4_500n)
  })
})
