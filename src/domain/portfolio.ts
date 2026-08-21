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
    description: 'Prioritises capital stability, liquid reserves, and tightly capped yield positions.',
    baseStableBps: 7_000n,
    driftBandBps: 500n,
    maxSlippageBps: 50n,
    maxActionBps: 2_500n,
    dailyTurnoverBps: 3_500n,
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced',
    description: 'Balances spot exposure, fee income, farming rewards, and withdrawal liquidity.',
    baseStableBps: 4_500n,
    driftBandBps: 800n,
    maxSlippageBps: 100n,
    maxActionBps: 3_500n,
    dailyTurnoverBps: 5_000n,
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    description: 'Accepts more market and LP exposure while preserving a hard minimum reserve.',
    baseStableBps: 2_000n,
    driftBandBps: 1_000n,
    maxSlippageBps: 150n,
    maxActionBps: 4_500n,
    dailyTurnoverBps: 7_000n,
  },
}

export const goalOptions: Array<{ id: InvestmentGoal; name: string; description: string }> = [
  { id: 'preserve', name: 'Preserve capital', description: 'Prioritise liquid reserves and lower-risk sources of yield.' },
  { id: 'balanced-growth', name: 'Balanced growth', description: 'Combine market exposure, liquidity fees, and farming income.' },
  { id: 'maximize-growth', name: 'Maximise growth', description: 'Allocate more to spot and liquidity positions without using leverage.' },
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
  targetReserveBps,
}: {
  snapshot: PortfolioSnapshot
  managedAmount: bigint
  goal: InvestmentGoal
  risk: RiskProfileId
  targetReserveBps?: bigint
}): PortfolioPlan {
  const profile = riskProfiles[risk]
  const price = snapshot.priceStablePerNative > 0n ? snapshot.priceStablePerNative : parseEther('1')
  const availableNative = snapshot.nativeBalance > GAS_RESERVE ? snapshot.nativeBalance - GAS_RESERVE : 0n
  const stableValueInNative = snapshot.stableBalance * parseEther('1') / price
  const walletValue = availableNative + stableValueInNative
  const managedValue = min(managedAmount, walletValue)
  const stableInScope = min(stableValueInNative, managedValue)
  const currentStableBps = safeBps(stableInScope, managedValue)
  const targetStableBps = clamp(targetReserveBps ?? targetStableBpsFor(goal, risk), 0n, 10_000n)
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
        ? `The liquid-reserve sleeve is below its ${formatPercent(targetStableBps)} execution target, so the live Swap adapter can convert ${formatNative(amountIn)} tBNB to BUSD within the mandate.`
        : 'The liquid-reserve sleeve is below target, but the gas reserve leaves no tBNB available for the next Swap action.',
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
        ? `The liquid-reserve sleeve is above its ${formatPercent(targetStableBps)} execution target, so the live Swap adapter can convert ${formatStable(amountIn)} BUSD to tBNB within the mandate.`
        : 'The liquid-reserve sleeve is above target, but no BUSD is available for the next Swap action.',
    }
  }

  return {
    action: 'HOLD', managedAmount, managedValue, availableNative, stableValueInNative,
    currentStableBps, targetStableBps, projectedStableBps: currentStableBps,
    driftBandBps: profile.driftBandBps, amountIn: 0n, inputAsset: 'tBNB', outputAsset: 'BUSD',
    maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
    rationale: `The liquid-reserve sleeve is inside its ${formatPercent(lowerBound)}–${formatPercent(upperBound)} execution band. The strategy keeps the current Swap position while other sleeves remain subject to their own approval and adapter status.`,
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
