import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { activationFundingRequirement, buildPortfolioPlan, targetStableBpsFor } from './portfolio'

const now = '2026-08-20T00:00:00.000Z'

describe('portfolio policy engine', () => {
  it('does not request the original deposit again after startup conversion', () => {
    const requirement = activationFundingRequirement(
      parseEther('0.00294'),
      parseEther('0.4126'),
      parseEther('0.1'),
    )

    expect(requirement.portfolioFunded).toBe(true)
    expect(requirement.ready).toBe(true)
    expect(requirement.targetBalance).toBe(parseEther('0.003'))
  })

  it('tops up only the Gas reserve when a funded portfolio falls below the low watermark', () => {
    const requirement = activationFundingRequirement(
      parseEther('0.001'),
      parseEther('0.4126'),
      parseEther('0.1'),
    )

    expect(requirement.ready).toBe(false)
    expect(requirement.missing).toBe(parseEther('0.002'))
  })

  it('requires the requested capital before the first startup conversion', () => {
    const requirement = activationFundingRequirement(
      parseEther('0.02'),
      0n,
      parseEther('0.1'),
    )

    expect(requirement.portfolioFunded).toBe(false)
    expect(requirement.ready).toBe(false)
    expect(requirement.missing).toBe(parseEther('0.08'))
  })

  it('combines goal and risk into a deterministic stable target', () => {
    expect(targetStableBpsFor('preserve', 'conservative')).toBe(8_000n)
    expect(targetStableBpsFor('balanced-growth', 'balanced')).toBe(4_500n)
    expect(targetStableBpsFor('maximize-growth', 'growth')).toBe(1_000n)
  })

  it('buys USDT when stable exposure is below the policy band', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.023'),
        stableBalance: 0n,
        stablecoin: 'USDT',
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('10'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })

    expect(plan.action).toBe('BUY_STABLE')
    expect(plan.amountIn).toBe(parseEther('0.007'))
    expect(plan.projectedStableBps).toBe(3_500n)
  })

  it('holds when allocation remains inside the allowed drift band', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.014'),
        stableBalance: parseEther('4.5'),
        stablecoin: 'USDT',
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('10'),
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
        nativeBalance: parseEther('0.0015'),
        stableBalance: parseEther('10'),
        stablecoin: 'USDT',
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('10'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })

    expect(plan.action).toBe('BUY_NATIVE')
    expect(plan.amountIn).toBe(parseEther('3.5'))
    expect(plan.projectedStableBps).toBe(6_500n)
  })

  it('restores a low Gas reserve before considering portfolio drift', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.0008'),
        stableBalance: parseEther('10'),
        stablecoin: 'USDC',
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('10'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })

    expect(plan.action).toBe('BUY_NATIVE')
    expect(plan.purpose).toBe('GAS_TOP_UP')
    expect(plan.amountIn).toBe(parseEther('1.1'))
    expect(plan.outputAsset).toBe('tBNB')
  })

  it('uses the composed strategy reserve as the live execution target', () => {
    const plan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.015'),
        stableBalance: parseEther('4'),
        stablecoin: 'USDC',
        priceStablePerNative: parseEther('500'),
        updatedAt: now,
      },
      managedAmount: parseEther('10'),
      goal: 'balanced-growth',
      risk: 'balanced',
      targetReserveBps: 2_500n,
    })

    expect(plan.targetStableBps).toBe(2_500n)
    expect(plan.stablecoin).toBe('USDC')
    expect(plan.amountIn).toBe(parseEther('1.5'))
  })
})
