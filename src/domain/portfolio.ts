import { formatEther, formatUnits, parseEther } from 'viem'
import type { StablecoinSymbol } from '../lib/tokens'

export type RiskProfileId = 'conservative' | 'balanced' | 'growth'
export type InvestmentGoal = 'preserve' | 'balanced-growth' | 'maximize-growth'
export type RebalanceAction = 'BUY_STABLE' | 'BUY_NATIVE' | 'HOLD'
export type PortfolioAsset = 'tBNB' | StablecoinSymbol
export type PortfolioPlanPurpose = 'PORTFOLIO_REBALANCE' | 'GAS_TOP_UP'

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
  stablecoin: StablecoinSymbol
  priceStablePerNative: bigint
  updatedAt: string
}

export type PortfolioPlan = {
  action: RebalanceAction
  purpose: PortfolioPlanPurpose
  stablecoin: StablecoinSymbol
  managedAmount: bigint
  managedValue: bigint
  availableNative: bigint
  nativeValueInStable: bigint
  priceStablePerNative: bigint
  currentStableBps: bigint
  targetStableBps: bigint
  projectedStableBps: bigint
  driftBandBps: bigint
  amountIn: bigint
  inputAsset: PortfolioAsset
  outputAsset: PortfolioAsset
  maxSlippageBps: bigint
  dailyNativeCap: bigint
  dailyStableCap: bigint
  rationale: string
}

export const GAS_RESERVE = parseEther('0.003')
export const GAS_LOW_WATERMARK = parseEther('0.0015')

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
  const nativeValueInStable = availableNative * price / parseEther('1')
  const walletValue = snapshot.stableBalance + nativeValueInStable
  const managedValue = min(managedAmount, walletValue)
  const stableInScope = min(snapshot.stableBalance, managedValue)
  const currentStableBps = safeBps(stableInScope, managedValue)
  const targetStableBps = clamp(targetReserveBps ?? targetStableBpsFor(goal, risk), 0n, 10_000n)
  const targetStableValue = managedValue * targetStableBps / 10_000n
  const maxActionStable = managedValue * profile.maxActionBps / 10_000n
  const dailyStableCap = managedValue * profile.dailyTurnoverBps / 10_000n
  const dailyNativeCap = dailyStableCap * parseEther('1') / price
  const lowerBound = targetStableBps > profile.driftBandBps ? targetStableBps - profile.driftBandBps : 0n
  const upperBound = min(10_000n, targetStableBps + profile.driftBandBps)

  if (snapshot.nativeBalance < GAS_LOW_WATERMARK && snapshot.stableBalance > 0n && managedValue > 0n) {
    const nativeShortfall = GAS_RESERVE - snapshot.nativeBalance
    const stableNeeded = nativeShortfall * price / parseEther('1')
    const amountIn = min(stableNeeded, snapshot.stableBalance, dailyStableCap)
    const nativeReceived = amountIn * parseEther('1') / price
    const projectedStableBps = safeBps(stableInScope > amountIn ? stableInScope - amountIn : 0n, managedValue)
    return {
      action: amountIn > 0n ? 'BUY_NATIVE' : 'HOLD', purpose: 'GAS_TOP_UP', stablecoin: snapshot.stablecoin,
      managedAmount, managedValue, availableNative, nativeValueInStable, priceStablePerNative: price, currentStableBps,
      targetStableBps, projectedStableBps, driftBandBps: profile.driftBandBps, amountIn,
      inputAsset: snapshot.stablecoin, outputAsset: 'tBNB', maxSlippageBps: profile.maxSlippageBps,
      dailyNativeCap, dailyStableCap,
      rationale: amountIn > 0n
        ? `The Gas reserve fell below ${formatNative(GAS_LOW_WATERMARK)} tBNB. Convert up to ${formatStable(amountIn)} ${snapshot.stablecoin} to restore approximately ${formatNative(snapshot.nativeBalance + nativeReceived)} tBNB; record this operational top-up separately from portfolio rebalancing.`
        : `The Gas reserve is below its safety threshold, but no approved ${snapshot.stablecoin} amount is available for a bounded top-up.`,
    }
  }

  if (managedValue === 0n) {
    return {
      action: 'HOLD', purpose: 'PORTFOLIO_REBALANCE', stablecoin: snapshot.stablecoin, managedAmount, managedValue, availableNative,
      nativeValueInStable, priceStablePerNative: price, currentStableBps: 0n, targetStableBps, projectedStableBps: 0n,
      driftBandBps: profile.driftBandBps, amountIn: 0n, inputAsset: snapshot.stablecoin, outputAsset: 'tBNB',
      maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
      rationale: `Deposit ${snapshot.stablecoin} into the owner smart account before the strategy can calculate an executable allocation.`,
    }
  }

  if (currentStableBps < lowerBound) {
    const deficitStable = targetStableValue > stableInScope ? targetStableValue - stableInScope : 0n
    const nativeNeeded = deficitStable * parseEther('1') / price
    const maxActionNative = maxActionStable * parseEther('1') / price
    const amountIn = min(nativeNeeded, maxActionNative, availableNative)
    const convertedStable = amountIn * price / parseEther('1')
    const projectedStableBps = safeBps(stableInScope + convertedStable, managedValue)
    return {
      action: amountIn > 0n ? 'BUY_STABLE' : 'HOLD', purpose: 'PORTFOLIO_REBALANCE', stablecoin: snapshot.stablecoin,
      managedAmount, managedValue, availableNative, nativeValueInStable, priceStablePerNative: price, currentStableBps,
      targetStableBps, projectedStableBps, driftBandBps: profile.driftBandBps, amountIn,
      inputAsset: 'tBNB', outputAsset: snapshot.stablecoin, maxSlippageBps: profile.maxSlippageBps,
      dailyNativeCap, dailyStableCap,
      rationale: amountIn > 0n
        ? `The liquid reserve is below its ${formatPercent(targetStableBps)} target, so the bounded Swap adapter can convert ${formatNative(amountIn)} tBNB back to ${snapshot.stablecoin}.`
        : `The ${snapshot.stablecoin} reserve is below target, but the protected Gas balance leaves no tBNB available for reallocation.`,
    }
  }

  if (currentStableBps > upperBound) {
    const surplusStable = stableInScope > targetStableValue ? stableInScope - targetStableValue : 0n
    const amountIn = min(surplusStable, maxActionStable, snapshot.stableBalance)
    const projectedStableBps = safeBps(stableInScope - amountIn, managedValue)
    return {
      action: amountIn > 0n ? 'BUY_NATIVE' : 'HOLD', purpose: 'PORTFOLIO_REBALANCE', stablecoin: snapshot.stablecoin,
      managedAmount, managedValue, availableNative, nativeValueInStable, priceStablePerNative: price, currentStableBps,
      targetStableBps, projectedStableBps, driftBandBps: profile.driftBandBps, amountIn,
      inputAsset: snapshot.stablecoin, outputAsset: 'tBNB', maxSlippageBps: profile.maxSlippageBps,
      dailyNativeCap, dailyStableCap,
      rationale: amountIn > 0n
        ? `The ${snapshot.stablecoin} reserve is above its ${formatPercent(targetStableBps)} target, so the live adapter can deploy ${formatStable(amountIn)} ${snapshot.stablecoin} into bounded tBNB market exposure.`
        : `The ${snapshot.stablecoin} reserve is above target, but no stablecoin is available for the next action.`,
    }
  }

  return {
    action: 'HOLD', purpose: 'PORTFOLIO_REBALANCE', stablecoin: snapshot.stablecoin, managedAmount, managedValue, availableNative,
    nativeValueInStable, priceStablePerNative: price, currentStableBps, targetStableBps, projectedStableBps: currentStableBps,
    driftBandBps: profile.driftBandBps, amountIn: 0n, inputAsset: snapshot.stablecoin, outputAsset: 'tBNB',
    maxSlippageBps: profile.maxSlippageBps, dailyNativeCap, dailyStableCap,
    rationale: `The ${snapshot.stablecoin} reserve is inside its ${formatPercent(lowerBound)}–${formatPercent(upperBound)} execution band.`,
  }
}

export function formatPercent(bps: bigint) {
  return `${Number(bps) / 100}%`
}

export function formatNative(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export function formatStable(value: bigint) {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })
}
