import { describe, expect, it } from 'vitest'
import { allocationFor, buildStrategyPlan } from './strategy'

describe('AI strategy composition', () => {
  it('always produces a complete allocation', () => {
    const plan = buildStrategyPlan({
      goal: 'balanced-growth',
      risk: 'balanced',
      liquidityNeed: 'weekly',
      horizonDays: 14,
    })

    expect(plan.sleeves.reduce((sum, sleeve) => sum + sleeve.allocationBps, 0)).toBe(10_000)
    expect(plan.actions).toHaveLength(4)
  })

  it('preserves more liquid capital for on-demand withdrawals', () => {
    const anytime = buildStrategyPlan({
      goal: 'balanced-growth',
      risk: 'balanced',
      liquidityNeed: 'anytime',
      horizonDays: 14,
    })
    const term = buildStrategyPlan({
      goal: 'balanced-growth',
      risk: 'balanced',
      liquidityNeed: 'term',
      horizonDays: 14,
    })

    expect(allocationFor(anytime, 'reserve')).toBeGreaterThan(allocationFor(term, 'reserve'))
  })

  it('keeps every strategy unlevered and inside LP limits', () => {
    for (const risk of ['conservative', 'balanced', 'growth'] as const) {
      const plan = buildStrategyPlan({
        goal: 'maximize-growth',
        risk,
        liquidityNeed: 'term',
        horizonDays: 30,
      })

      expect(plan.guardrails.leverageAllowed).toBe(false)
      expect(allocationFor(plan, 'reserve')).toBeGreaterThanOrEqual(plan.guardrails.minimumReserveBps)
      expect(allocationFor(plan, 'liquidity')).toBeLessThanOrEqual(plan.guardrails.maximumLiquidityBps)
    }
  })

  it('exposes execution coverage instead of presenting planned adapters as live', () => {
    const plan = buildStrategyPlan({
      goal: 'balanced-growth',
      risk: 'balanced',
      liquidityNeed: 'weekly',
      horizonDays: 14,
    })

    expect(plan.actions.find((action) => action.tool === 'smart-router')?.coverage).toBe('LIVE')
    expect(plan.actions.find((action) => action.tool === 'universal-farms')?.coverage).toBe('ADAPTER_PLANNED')
  })
})
