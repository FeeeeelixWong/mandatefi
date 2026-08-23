import type { PancakeModuleReceipt } from '../types'

export type RealizedPerformance =
  | { state: 'NO_REALIZATION'; amountStable: 0; returnBps: 0 }
  | { state: 'VALUATION_REQUIRED'; amountStable: null; returnBps: null }

export type PortfolioPerformance = {
  estimatedApyBps: number
  projectedTermReturnBps: number
  projectedTermIncomeStable: number
  realized: RealizedPerformance
}

export function buildPortfolioPerformance({
  capitalStable,
  durationDays,
  estimatedApyBps,
  receipts = [],
}: {
  capitalStable: number
  durationDays: number
  estimatedApyBps: number
  receipts?: PancakeModuleReceipt[]
}): PortfolioPerformance {
  const safeCapital = Number.isFinite(capitalStable) ? Math.max(0, capitalStable) : 0
  const safeDuration = Number.isFinite(durationDays) ? Math.max(0, durationDays) : 0
  const safeApy = Number.isFinite(estimatedApyBps) ? Math.max(0, Math.round(estimatedApyBps)) : 0
  const projectedTermReturnBps = Math.round(safeApy * safeDuration / 365)
  const projectedTermIncomeStable = safeCapital * projectedTermReturnBps / 10_000
  const hasConfirmedRealization = receipts.some((receipt) => (
    receipt.state === 'CONFIRMED' &&
    (receipt.operation === 'WITHDRAW' || receipt.operation === 'REMOVE_LIQUIDITY')
  ))

  return {
    estimatedApyBps: safeApy,
    projectedTermReturnBps,
    projectedTermIncomeStable,
    realized: hasConfirmedRealization
      ? { state: 'VALUATION_REQUIRED', amountStable: null, returnBps: null }
      : { state: 'NO_REALIZATION', amountStable: 0, returnBps: 0 },
  }
}
