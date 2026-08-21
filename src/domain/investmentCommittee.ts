import type { PortfolioPlan, PortfolioSnapshot } from './portfolio.js'
import type { StrategyPlan } from './strategy.js'
import type { ProtocolSignals } from './triggerEngine.js'
import {
  protocolLabel,
  selectEarnOpportunity,
  selectFarmOpportunity,
  selectLiquidityOpportunity,
  type PancakeResearchSnapshot,
} from '../integrations/pancakeResearch.js'
import type { PancakeMarketSnapshot } from '../integrations/pancakeMarket.js'

export type SpecialistAgentId = 'market' | 'liquidity' | 'farms' | 'earn' | 'execution-cost'
export type AgentDataStatus = 'READY' | 'STALE' | 'UNAVAILABLE'
export type AgentStance = 'SUPPORT' | 'NEUTRAL' | 'CAUTION' | 'BLOCK'
export type AgentModelMode = 'DEEPSEEK' | 'DETERMINISTIC_FALLBACK'

export type AgentInference = {
  mode: AgentModelMode
  model: string
  promptVersion: string
  latencyMs: number
}

export type ExecutionCostEstimate = {
  observedAt: string
  gasPriceGwei: number
  gasUnits: number
  gasCostNative: string
  gasCostBps: number
  slippageReserveBps: number
  priceImpactBps: number
  exitCostBps: number
  totalCostBps: number
  source: 'BSC_RPC_AND_PANCAKESWAP_QUOTE' | 'NO_ACTION'
  note: string
}

export type SpecialistReport = {
  agentId: SpecialistAgentId
  name: string
  remit: string
  cadenceMinutes: number
  generatedAt: string
  dataAsOf?: string
  status: AgentDataStatus
  stance: AgentStance
  confidence: number
  headline: string
  findings: string[]
  missingInputs: string[]
  sourceLabel?: string
  sourceUrl?: string
  estimatedGrossBenefitBps: number | null
  estimatedRiskCostBps: number | null
  inference?: AgentInference
}

export type SpecialistJudgement = Pick<
  SpecialistReport,
  'agentId' | 'stance' | 'confidence' | 'headline' | 'findings' | 'missingInputs'
> & { inference: AgentInference }

export type InvestmentCommittee = {
  generatedAt: string
  reports: SpecialistReport[]
  readyAgents: number
  staleAgents: number
  unavailableAgents: number
  grossBenefitBps: number | null
  riskCostBps: number
  executionCostBps: number | null
  netBenefitBps: number | null
  minimumNetBenefitBps: number
  costGatePassed: boolean
  dissentingAgents: SpecialistAgentId[]
  summary: string
  modelMode?: 'DEEPSEEK' | 'HYBRID_FALLBACK' | 'DETERMINISTIC_FALLBACK'
  runId?: string
}

type CommitteeContext = {
  nowMs?: number
  strategy: StrategyPlan
  executionPlan: PortfolioPlan
  snapshot?: PortfolioSnapshot | null
  signals?: ProtocolSignals
  executionCost?: ExecutionCostEstimate | null
  pancakeResearch?: PancakeResearchSnapshot | null
  pancakeMarket?: PancakeMarketSnapshot | null
}

function freshnessStatus(observedAt: string | undefined, nowMs: number, staleAfterMinutes: number): AgentDataStatus {
  if (!observedAt) return 'UNAVAILABLE'
  const observedMs = Date.parse(observedAt)
  if (!Number.isFinite(observedMs)) return 'UNAVAILABLE'
  return nowMs - observedMs <= staleAfterMinutes * 60_000 ? 'READY' : 'STALE'
}

function report(input: Omit<SpecialistReport, 'generatedAt'>, generatedAt: string): SpecialistReport {
  return { ...input, generatedAt }
}

function compactUsd(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function exactUsd(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  }).format(value)
}

function combinedMarketStatus(
  snapshotObservedAt: string | undefined,
  marketObservedAt: string | undefined,
  nowMs: number,
): AgentDataStatus {
  const portfolioStatus = freshnessStatus(snapshotObservedAt, nowMs, 15)
  const officialPriceStatus = freshnessStatus(marketObservedAt, nowMs, 5)
  if (portfolioStatus === 'UNAVAILABLE' || officialPriceStatus === 'UNAVAILABLE') return 'UNAVAILABLE'
  if (portfolioStatus === 'STALE' || officialPriceStatus === 'STALE') return 'STALE'
  return 'READY'
}

function pairRiskCostBps(pair: string) {
  const symbols = pair.toUpperCase().split('/')
  const stables = new Set(['USDT', 'USDC'])
  if (symbols.every((symbol) => stables.has(symbol))) return 35
  if (symbols.includes('CAKE')) return 650
  if (symbols.some((symbol) => stables.has(symbol))) return 300
  return 475
}

export function buildInvestmentCommittee(context: CommitteeContext): InvestmentCommittee {
  const nowMs = context.nowMs ?? Date.now()
  const generatedAt = new Date(nowMs).toISOString()
  const signals = context.signals ?? {}
  const plan = context.executionPlan
  const research = context.pancakeResearch ?? null
  const market = context.pancakeMarket ?? null
  const liquidityOpportunity = research ? selectLiquidityOpportunity(research, context.strategy.riskProfile) : null
  const farmOpportunity = research ? selectFarmOpportunity(research, context.strategy.riskProfile) : null
  const earnOpportunity = research ? selectEarnOpportunity(research) : null
  const driftBps = Math.abs(Number(plan.currentStableBps - plan.targetStableBps))
  const portfolioMarketStatus = freshnessStatus(context.snapshot?.updatedAt, nowMs, 15)
  const officialPriceStatus = freshnessStatus(market?.observedAt, nowMs, 5)
  const marketStatus = combinedMarketStatus(context.snapshot?.updatedAt, market?.observedAt, nowMs)
  const stablecoinDepeg = (market?.stablecoinMaxDeviationBps ?? 0) >= 100
  const liquidityStatus = liquidityOpportunity
    ? freshnessStatus(research?.liquidity.observedAt, nowMs, 35)
    : signals.lpRangeDistanceBps === undefined && signals.impermanentLossBps === undefined && signals.liquidityChangeBps === undefined
      ? 'UNAVAILABLE'
      : freshnessStatus(signals.liquidityObservedAt, nowMs, 20)
  const farmStatus = farmOpportunity
    ? freshnessStatus(research?.farms.observedAt, nowMs, 50)
    : signals.currentNetYieldBps === undefined
      ? 'UNAVAILABLE'
      : freshnessStatus(signals.farmObservedAt, nowMs, 45)
  const earnStatus = earnOpportunity
    ? freshnessStatus(research?.earn.observedAt, nowMs, 90)
    : signals.earnNetYieldBps === undefined
      ? 'UNAVAILABLE'
      : freshnessStatus(signals.earnObservedAt, nowMs, 90)
  const costStatus = plan.action === 'HOLD'
    ? 'READY'
    : freshnessStatus(context.executionCost?.observedAt, nowMs, 2)

  const reports: SpecialistReport[] = [
    report({
      agentId: 'market',
      name: 'Market analyst',
      remit: 'Spot price, reserve drift, volatility and depeg surveillance',
      cadenceMinutes: 5,
      dataAsOf: market?.observedAt,
      status: marketStatus,
      stance: marketStatus !== 'READY' || stablecoinDepeg ? 'BLOCK' : plan.action === 'HOLD' ? 'NEUTRAL' : 'SUPPORT',
      confidence: marketStatus === 'READY' ? 94 : marketStatus === 'STALE' ? 45 : 20,
      headline: marketStatus === 'READY'
        ? stablecoinDepeg
          ? `Stablecoin deviation reached ${(market?.stablecoinMaxDeviationBps ?? 0) / 100}%; autonomous execution is blocked.`
          : plan.action === 'HOLD' ? 'Official market prices and reserve allocation remain inside policy.' : `${driftBps / 100}% reserve drift requires review.`
        : 'Official PancakeSwap market evidence or the execution snapshot is missing or stale.',
      findings: [
        ...(market ? [
          `Official USD prices: BNB ${exactUsd(market.pricesUsd.bnb)} · CAKE ${exactUsd(market.pricesUsd.cake)}.`,
          `Stablecoins: USDT ${exactUsd(market.pricesUsd.usdt)} · USDC ${exactUsd(market.pricesUsd.usdc)} · max deviation ${market.stablecoinMaxDeviationBps} bps.`,
        ] : []),
        ...(context.snapshot ? [
          `BSC Testnet execution quote: ${Number(context.snapshot.priceStablePerNative) / 1e18} ${context.snapshot.stablecoin} per tBNB.`,
          `Reserve: ${Number(plan.currentStableBps) / 100}% current vs ${Number(plan.targetStableBps) / 100}% target.`,
        ] : []),
      ],
      missingInputs: [
        ...(officialPriceStatus === 'READY' ? [] : ['Fresh BNB, CAKE, USDT and USDC prices from the PancakeSwap Price API SDK']),
        ...(portfolioMarketStatus === 'READY' ? [] : ['Fresh BSC Testnet wallet balances and executable router quote']),
      ],
      sourceLabel: market ? 'PancakeSwap Price API SDK' : undefined,
      sourceUrl: market?.sourceUrl,
      estimatedGrossBenefitBps: null,
      estimatedRiskCostBps: null,
    }, generatedAt),
    report({
      agentId: 'liquidity',
      name: 'LP analyst',
      remit: 'Pool depth, fee APR, range health and impermanent loss',
      cadenceMinutes: 10,
      dataAsOf: research?.liquidity.observedAt ?? signals.liquidityObservedAt,
      status: liquidityStatus,
      stance: liquidityStatus !== 'READY'
        ? 'CAUTION'
        : signals.impermanentLossBps !== undefined && signals.impermanentLossBps >= context.strategy.guardrails.maximumImpermanentLossBps
          ? 'BLOCK'
          : liquidityOpportunity ? 'SUPPORT' : 'NEUTRAL',
      confidence: liquidityStatus === 'READY' ? 88 : liquidityStatus === 'STALE' ? 45 : 25,
      headline: liquidityOpportunity
        ? `${liquidityOpportunity.pair} ${protocolLabel(liquidityOpportunity.protocol)} · ${liquidityOpportunity.feeAprBps / 100}% fee APR.`
        : signals.lpRangeDistanceBps === undefined ? 'No verified LP opportunity or position telemetry is available.' : 'LP range and IL telemetry reviewed.',
      findings: [
        ...(liquidityOpportunity ? [
          `${compactUsd(liquidityOpportunity.tvlUsd)} TVL · ${compactUsd(liquidityOpportunity.volumeUsd24h)} 24h volume.`,
          `${liquidityOpportunity.feeTierBps ?? 0} bps pool fee tier.`,
        ] : []),
        ...(signals.lpRangeDistanceBps === undefined ? [] : [`Range distance: ${signals.lpRangeDistanceBps / 100}%.`]),
        ...(signals.impermanentLossBps === undefined ? [] : [`Impermanent loss: ${signals.impermanentLossBps / 100}%.`]),
      ],
      missingInputs: liquidityOpportunity || signals.lpRangeDistanceBps !== undefined ? [] : ['Verified pool liquidity, fee APR and range state'],
      sourceLabel: liquidityOpportunity ? 'PancakeSwap Explorer' : undefined,
      sourceUrl: liquidityOpportunity?.link,
      estimatedGrossBenefitBps: liquidityOpportunity?.feeAprBps ?? signals.lpFeeAprBps ?? null,
      estimatedRiskCostBps: liquidityOpportunity ? pairRiskCostBps(liquidityOpportunity.pair) : signals.impermanentLossBps ?? null,
    }, generatedAt),
    report({
      agentId: 'farms',
      name: 'Farm analyst',
      remit: 'Net incentives, emissions decay, lock terms and exit liquidity',
      cadenceMinutes: 30,
      dataAsOf: research?.farms.observedAt ?? signals.farmObservedAt,
      status: farmStatus,
      stance: farmStatus !== 'READY'
        ? 'CAUTION'
        : signals.currentNetYieldBps !== undefined && signals.bestAlternativeNetYieldBps !== undefined && signals.currentNetYieldBps < signals.bestAlternativeNetYieldBps
          ? 'CAUTION'
          : farmOpportunity ? 'SUPPORT' : 'NEUTRAL',
      confidence: farmStatus === 'READY' ? 86 : farmStatus === 'STALE' ? 42 : 22,
      headline: farmOpportunity
        ? `${farmOpportunity.pair} · ${farmOpportunity.totalAprBps / 100}% gross Farm APR.`
        : signals.currentNetYieldBps === undefined ? 'No verified active Farm matches this risk mandate.' : 'Farm rewards were compared after known costs.',
      findings: farmOpportunity ? [
        `${farmOpportunity.feeAprBps / 100}% fees + ${farmOpportunity.rewardAprBps / 100}% CAKE rewards.`,
        `${compactUsd(farmOpportunity.tvlUsd)} TVL · MasterChef PID ${farmOpportunity.pid}.`,
      ] : signals.currentNetYieldBps === undefined ? [] : [`Current net yield: ${signals.currentNetYieldBps / 100}%.`],
      missingInputs: farmOpportunity || signals.currentNetYieldBps !== undefined ? [] : ['Active farm emissions, APR and exit liquidity'],
      sourceLabel: farmOpportunity ? 'MasterChef V3 + Explorer' : undefined,
      sourceUrl: farmOpportunity?.link,
      estimatedGrossBenefitBps: farmOpportunity?.totalAprBps ?? signals.currentNetYieldBps ?? null,
      estimatedRiskCostBps: farmOpportunity ? pairRiskCostBps(farmOpportunity.pair) + 75 : signals.farmRiskCostBps ?? null,
    }, generatedAt),
    report({
      agentId: 'earn',
      name: 'Earn analyst',
      remit: 'Vault APY, reward accrual, compounding threshold and withdrawal terms',
      cadenceMinutes: 60,
      dataAsOf: research?.earn.observedAt ?? signals.earnObservedAt,
      status: earnStatus,
      stance: earnStatus !== 'READY'
        ? 'CAUTION'
        : signals.pendingRewardsValueBps !== undefined && signals.pendingRewardsValueBps < context.strategy.guardrails.minimumNetBenefitBps
          ? 'CAUTION'
          : earnOpportunity ? 'SUPPORT' : 'NEUTRAL',
      confidence: earnStatus === 'READY' ? 84 : earnStatus === 'STALE' ? 40 : 20,
      headline: earnOpportunity
        ? `${earnOpportunity.stakeSymbol} → ${earnOpportunity.earnSymbol} · ${earnOpportunity.rewardAprBps / 100}% reward APR.`
        : signals.earnNetYieldBps === undefined ? 'No verified active Earn pool is available.' : 'Earn yield and compounding threshold reviewed.',
      findings: earnOpportunity ? [
        `${compactUsd(earnOpportunity.tvlUsd)} TVL · ${earnOpportunity.withdrawal}.`,
        'APR excludes CAKE price risk and execution costs.',
      ] : signals.earnNetYieldBps === undefined ? [] : [`Current net vault yield: ${signals.earnNetYieldBps / 100}%.`],
      missingInputs: earnOpportunity || signals.earnNetYieldBps !== undefined ? [] : ['Active Earn APY, rewards and withdrawal state'],
      sourceLabel: earnOpportunity ? 'PancakeSwap Syrup Pools' : undefined,
      sourceUrl: earnOpportunity?.link,
      estimatedGrossBenefitBps: earnOpportunity?.rewardAprBps ?? signals.earnNetYieldBps ?? null,
      estimatedRiskCostBps: earnOpportunity ? 450 : signals.earnRiskCostBps ?? null,
    }, generatedAt),
    report({
      agentId: 'execution-cost',
      name: 'Execution cost analyst',
      remit: 'Live gas, route slippage, price impact and exit friction',
      cadenceMinutes: 1,
      dataAsOf: context.executionCost?.observedAt ?? (plan.action === 'HOLD' ? generatedAt : undefined),
      status: costStatus,
      stance: costStatus !== 'READY' ? 'BLOCK' : (context.executionCost?.totalCostBps ?? 0) > context.strategy.guardrails.maximumExecutionCostBps ? 'BLOCK' : plan.action === 'HOLD' ? 'NEUTRAL' : 'SUPPORT',
      confidence: costStatus === 'READY' ? 95 : 15,
      headline: plan.action === 'HOLD'
        ? 'No execution proposed, so no transaction cost is incurred.'
        : context.executionCost ? `Worst-case execution cost: ${context.executionCost.totalCostBps / 100}%.` : 'A live gas and route-cost estimate is required.',
      findings: context.executionCost ? [
        `Gas: ${context.executionCost.gasCostNative} tBNB (${context.executionCost.gasCostBps / 100}%).`,
        `Slippage reserve: ${context.executionCost.slippageReserveBps / 100}%; price impact: ${context.executionCost.priceImpactBps / 100}%.`,
        context.executionCost.note,
      ] : [],
      missingInputs: costStatus === 'READY' ? [] : ['Fresh BSC gas price and PancakeSwap route quote'],
      sourceLabel: context.executionCost ? 'BSC RPC + PancakeSwap quote' : undefined,
      estimatedGrossBenefitBps: null,
      estimatedRiskCostBps: context.executionCost?.totalCostBps ?? null,
    }, generatedAt),
  ]

  const readyAgents = reports.filter((item) => item.status === 'READY').length
  const staleAgents = reports.filter((item) => item.status === 'STALE').length
  const unavailableAgents = reports.filter((item) => item.status === 'UNAVAILABLE').length
  const opportunityReports = reports.filter((item) => item.estimatedGrossBenefitBps !== null)
  const bestOpportunity = opportunityReports.sort((a, b) =>
    ((b.estimatedGrossBenefitBps ?? 0) - (b.estimatedRiskCostBps ?? 0)) -
    ((a.estimatedGrossBenefitBps ?? 0) - (a.estimatedRiskCostBps ?? 0)),
  )[0]
  const grossBenefitBps = bestOpportunity?.estimatedGrossBenefitBps ?? null
  const riskCostBps = bestOpportunity?.estimatedRiskCostBps ?? 0
  const executionCostBps = plan.action === 'HOLD' ? 0 : context.executionCost?.totalCostBps ?? null
  const netBenefitBps = grossBenefitBps !== null && executionCostBps !== null ? grossBenefitBps - riskCostBps - executionCostBps : null
  const costGatePassed = plan.action === 'HOLD' || (
    marketStatus === 'READY' &&
    !stablecoinDepeg &&
    costStatus === 'READY' &&
    (executionCostBps ?? Number.POSITIVE_INFINITY) <= context.strategy.guardrails.maximumExecutionCostBps
  )
  const dissentingAgents = reports.filter((item) => item.stance === 'BLOCK' || item.stance === 'CAUTION').map((item) => item.agentId)

  return {
    generatedAt,
    reports,
    readyAgents,
    staleAgents,
    unavailableAgents,
    grossBenefitBps,
    riskCostBps,
    executionCostBps,
    netBenefitBps,
    minimumNetBenefitBps: context.strategy.guardrails.minimumNetBenefitBps,
    costGatePassed,
    dissentingAgents,
    summary: plan.action === 'HOLD'
      ? research ? 'No mandate breach requires execution; specialists continue ranking verified PancakeSwap opportunities.' : 'The committee found no mandate breach requiring execution.'
      : costGatePassed
        ? 'Market evidence and live execution costs are inside the mandate cost ceiling.'
        : 'The committee withheld execution because cost evidence is missing, stale, or above the mandate ceiling.',
    modelMode: 'DETERMINISTIC_FALLBACK',
  }
}

export function applySpecialistJudgements(
  committee: InvestmentCommittee,
  judgements: SpecialistJudgement[],
  runId: string,
): InvestmentCommittee {
  const byAgent = new Map(judgements.map((judgement) => [judgement.agentId, judgement]))
  const reports = committee.reports.map((baseReport) => {
    const judgement = byAgent.get(baseReport.agentId)
    if (!judgement) {
      return {
        ...baseReport,
        inference: {
          mode: 'DETERMINISTIC_FALLBACK' as const,
          model: 'rules-engine',
          promptVersion: 'mandatefi.specialist.fallback.v1',
          latencyMs: 0,
        },
      }
    }
    return {
      ...baseReport,
      stance: judgement.stance,
      confidence: judgement.confidence,
      headline: judgement.headline,
      findings: judgement.findings,
      missingInputs: judgement.missingInputs,
      inference: judgement.inference,
    }
  })
  const deepSeekReports = reports.filter((report) => report.inference?.mode === 'DEEPSEEK').length

  return {
    ...committee,
    reports,
    dissentingAgents: reports
      .filter((report) => report.stance === 'BLOCK' || report.stance === 'CAUTION')
      .map((report) => report.agentId),
    modelMode: deepSeekReports === reports.length
      ? 'DEEPSEEK'
      : deepSeekReports > 0 ? 'HYBRID_FALLBACK' : 'DETERMINISTIC_FALLBACK',
    runId,
  }
}
