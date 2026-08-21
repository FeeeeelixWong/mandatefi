import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { buildPortfolioPlan } from './portfolio'
import { buildStrategyPlan } from './strategy'
import { evaluateTriggers, isCooldownActive } from './triggerEngine'

const nowMs = Date.parse('2026-08-21T12:00:00.000Z')
const strategy = buildStrategyPlan({ goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly', horizonDays: 30 })

function plan(stableBalance: string) {
  return buildPortfolioPlan({
    snapshot: {
      nativeBalance: stableBalance === '0' ? parseEther('0.0115') : parseEther('0.009'),
      stableBalance: parseEther(stableBalance),
      stablecoin: 'USDT',
      priceStablePerNative: parseEther('500'),
      updatedAt: new Date(nowMs).toISOString(),
    },
    managedAmount: parseEther('10'),
    goal: 'balanced-growth',
    risk: 'balanced',
    targetReserveBps: 2_500n,
  })
}

describe('strategy trigger engine', () => {
  it('does not run a scheduled review before the cadence is due', () => {
    const triggers = evaluateTriggers({
      source: 'MONITOR', nowMs, strategy, executionPlan: plan('1.25'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      expiry: Math.floor(nowMs / 1_000) + 30 * 24 * 60 * 60,
    })
    expect(triggers).toEqual([])
  })

  it('runs when the schedule is due or the reserve drifts', () => {
    const due = evaluateTriggers({
      source: 'MONITOR', nowMs, strategy, executionPlan: plan('1.25'),
      lastReviewAt: new Date(nowMs - 25 * 60 * 60 * 1_000).toISOString(),
      expiry: Math.floor(nowMs / 1_000) + 30 * 24 * 60 * 60,
    })
    const drift = evaluateTriggers({
      source: 'MONITOR', nowMs, strategy, executionPlan: plan('0'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      expiry: Math.floor(nowMs / 1_000) + 30 * 24 * 60 * 60,
    })
    expect(due.map((trigger) => trigger.kind)).toContain('SCHEDULE_DUE')
    expect(drift.map((trigger) => trigger.kind)).toContain('PORTFOLIO_DRIFT')
  })

  it('marks depeg signals as critical and enforces the action cooldown', () => {
    const triggers = evaluateTriggers({
      source: 'MONITOR', nowMs, strategy, executionPlan: plan('1.25'),
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      expiry: Math.floor(nowMs / 1_000) + 30 * 24 * 60 * 60,
      signals: { stablecoinDeviationBps: 125 },
    })
    expect(triggers.find((trigger) => trigger.kind === 'STABLECOIN_DEPEG')?.severity).toBe('critical')
    expect(isCooldownActive({ nowMs, strategy, lastExecutionAt: new Date(nowMs - 30 * 60 * 1_000).toISOString() })).toBe(true)
  })

  it('labels a reserve refill as a Gas event rather than allocation drift', () => {
    const gasPlan = buildPortfolioPlan({
      snapshot: {
        nativeBalance: parseEther('0.0005'),
        stableBalance: parseEther('10'),
        stablecoin: 'USDT',
        priceStablePerNative: parseEther('500'),
        updatedAt: new Date(nowMs).toISOString(),
      },
      managedAmount: parseEther('10'),
      goal: 'balanced-growth',
      risk: 'balanced',
    })
    const triggers = evaluateTriggers({
      source: 'MONITOR', nowMs, strategy, executionPlan: gasPlan,
      lastReviewAt: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
      expiry: Math.floor(nowMs / 1_000) + 30 * 24 * 60 * 60,
    })

    expect(triggers.map((trigger) => trigger.kind)).toContain('GAS_LOW')
    expect(triggers.map((trigger) => trigger.kind)).not.toContain('PORTFOLIO_DRIFT')
  })
})
