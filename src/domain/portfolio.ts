import { formatEther, parseEther } from 'viem'

export type RiskProfileId = 'conservative' | 'balanced' | 'growth'
export type InvestmentGoal = 'preserve' | 'balanced-growth' | 'maximize-growth'
export type RebalanceAction = 'BUY_STABLE' | 'BUY_NATIVE' | 'HOLD'

export type RiskProfile = {
  id: RiskProfileId
  name: string
  description: string
  baseStableBps: bigint
  driftBandBps: bigint
  maxSlippageBps: bigint
  maxActionBps: bigint
  dailyTurnoverBps: bigint
}

export type PortfolioSnapshot = {
  nativeBalance: bigint
  stableBalance: bigint
  priceStablePerNative: bigint
  updatedAt: string
}

export type PortfolioPlan = {
  action: RebalanceAction
  managedAmount: bigint
  managedValue: bigint
  availableNative: bigint
  stableValueInNative: bigint
  currentStableBps: bigint
  targetStableBps: bigint
  projectedStableBps: bigint
  driftBandBps: bigint
  amountIn: bigint
  inputAsset: 'tBNB' | 'BUSD'
  outputAsset: 'tBNB' | 'BUSD'
  maxSlippageBps: bigint
  dailyNativeCap: bigint
  dailyStableCap: bigint
  rationale: string
}

export const GAS_RESERVE = parseEther('0.0015')

export const riskProfiles: Record<RiskProfileId, RiskProfile> = {
  conservative: {
    id: 'conservative',
    name: 'Conservative',
    description: 'Prioritises capital stability and keeps most managed value in BUSD.',
    baseStableBps: 7_000n,
    driftBandBps: 500n,
    maxSlippageBps: 50n,
    maxActionBps: 2_500n,
    dailyTurnoverBps: 3_500n,
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'Balances BNB upside with a meaningful stablecoin buffer.',
    baseStableBps: 4_500n,
    driftBandBps: 800n,
    maxSlippageBps: 100n,
    maxActionBps: 3_500n,
    dailyTurnoverBps: 5_000n,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Keeps greater BNB exposure while preserving a smaller liquidity reserve.',
    baseStableBps: 2_000n,
    driftBandBps: 1_000n,
    maxSlippageBps: 150n,
    maxActionBps: 4_500n,
    dailyTurnoverBps: 7_000n,
  },
}

export const goalOptions: Array<{ id: InvestmentGoal; name: string; description: string }> = [
  { id: 'preserve', name: 'Preserve capital', description: 'Reduce volatility and maintain a larger stable reserve.' },
  { id: 'balanced-growth', name: 'Balanced growth', description: 'Participate in BNB upside without staying fully exposed.' },
  { id: 'maximize-growth', name: 'Maximise growth', description: 'Accept more volatility in exchange for higher BNB exposure.' },
]

function min(...values: bigint[]) {
  return values.reduce((smallest, value) => value < smallest ? value : smallest)
}

function clamp(value: bigint, low: bigint, high: bigint) {
  return value < low ? low : value > high ? high : value
}

function safeBps(part: bigint, total: bigint) {
  return total > 0n ? clamp(part * 10_000n / total, 0n, 10_000n) : 0n
}

export function targetStableBpsFor(goal: InvestmentGoal, risk: RiskProfileId) {
  const goalAdjustment = goal === 'preserve' ? 1_000n : goal === 'maximize-growth' ? -1_000n : 0n
  return clamp(riskProfiles[risk].baseStableBps + goalAdjustment, 1_000n, 8_500n)
}

export function buildPortfolioPlan({
  snapshot,
  managedAmount,
  goal,
  risk,
}: {
  snapshot: PortfolioSnapshot
  managedAmount: bigint
  goal: InvestmentGoal
  risk: RiskProfileId
}): PortfolioPlan {
  const profile = riskProfiles[risk]
  const price = snapshot.priceStablePerNative > 0n ? snapshot.priceStablePerNative : parseEther('1')
  const availableNative = snapshot.nativeBalance > GAS_RESERVE ? snapshot.nativeBalance - GAS_RESERVE : 0n
  const stableValueInNative = snapshot.stableBalance * parseEther('1') / price
  const walletValue = availableNative + stableValueInNative
  const managedValue = min(managedAmount, walletValue)
  const stableInScope = min(stableValueInNative, managedValue)
  const currentStableBps = safeBps(stableInScope, managedValue)
  const targetStableBps = targetStableBpsFor(goal, risk)
  const targetStableValue = managedValue * targetStableBps / 10_000n
  const maxActionNative = managedValue * profile.maxActionBps / 10_000n
  const dailyNativeCap = managedValue * profile.dailyTurnoverBps / 10_000n
  const dailyStableCap = dailyNativeCap * price / parseEther('1')
  const lowerBound = targetStableBps > profile.driftBandBps ? targetStableBps - profile.driftBandBps : 0n
  const upperBound = min(10_000n, targetStableBps + profile.driftBandBps)

  if (managedValue === 0n) {
    return {
      action: 'HOLD', managedAmount, managedValue, availableNative, stableValueInNative,
      currentStableBps: 0n, targetStableBps, projectedStableBps: 0n,
      driftBandBps: profile.driftBandBps, amountIn: 0n, inputAsset: 'tBNB', outputAsset: 'BUSD',
      maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
      rationale: 'Fund the smart wallet before the strategy can calculate an executable allocation.',
    }
  }

  if (currentStableBps < lowerBound) {
    const deficit = targetStableValue > stableInScope ? targetStableValue - stableInScope : 0n
    const amountIn = min(deficit, maxActionNative, availableNative)
    const projectedStableBps = safeBps(stableInScope + amountIn, managedValue)
    return {
      action: amountIn > 0n ? 'BUY_STABLE' : 'HOLD', managedAmount, managedValue, availableNative,
      stableValueInNative, currentStableBps, targetStableBps, projectedStableBps,
      driftBandBps: profile.driftBandBps, amountIn, inputAsset: 'tBNB', outputAsset: 'BUSD',
      maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
      rationale: amountIn > 0n
        ? `Stable exposure is below the ${formatPercent(targetStableBps)} target, so the next bounded action converts ${formatNative(amountIn)} tBNB to BUSD.`
        : 'Stable exposure is below target, but the gas reserve leaves no tBNB available to rebalance.',
    }
  }

  if (currentStableBps > upperBound) {
    const surplusNative = stableInScope > targetStableValue ? stableInScope - targetStableValue : 0n
    const nativeToSell = min(surplusNative, maxActionNative)
    const amountIn = min(nativeToSell * price / parseEther('1'), snapshot.stableBalance)
    const projectedStableBps = safeBps(stableInScope - min(stableInScope, nativeToSell), managedValue)
    return {
      action: amountIn > 0n ? 'BUY_NATIVE' : 'HOLD', managedAmount, managedValue, availableNative,
      stableValueInNative, currentStableBps, targetStableBps, projectedStableBps,
      driftBandBps: profile.driftBandBps, amountIn, inputAsset: 'BUSD', outputAsset: 'tBNB',
      maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
      rationale: amountIn > 0n
        ? `Stable exposure is above the ${formatPercent(targetStableBps)} target, so the next bounded action converts ${formatStable(amountIn)} BUSD to tBNB.`
        : 'Stable exposure is above target, but no BUSD is available in the managed wallet.',
    }
  }

  return {
    action: 'HOLD', managedAmount, managedValue, availableNative, stableValueInNative,
    currentStableBps, targetStableBps, projectedStableBps: currentStableBps,
    driftBandBps: profile.driftBandBps, amountIn: 0n, inputAsset: 'tBNB', outputAsset: 'BUSD',
    maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
    rationale: `Allocation is inside the ${formatPercent(lowerBound)}–${formatPercent(upperBound)} policy band. No transaction is needed.`,
  }
}

export function formatPercent(bps: bigint) {
  return `${Number(bps) / 100}%`
}

export function formatNative(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export function formatStable(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

