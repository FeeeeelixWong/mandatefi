import type { PortfolioPlan, PortfolioSnapshot } from './portfolio'
import type { StrategyPlan } from './strategy'
import type { ProtocolSignals } from './triggerEngine'

export type SpecialistAgentId = 'market' | 'liquidity' | 'farms' | 'earn' | 'execution-cost'
export type AgentDataStatus = 'READY' | 'STALE' | 'UNAVAILABLE'
export type AgentStance = 'SUPPORT' | 'NEUTRAL' | 'CAUTION' | 'BLOCK'

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
  estimatedGrossBenefitBps: number | null
  estimatedRiskCostBps: number | null
}

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
}

type CommitteeContext = {
  nowMs?: number
  strategy: StrategyPlan
  executionPlan: PortfolioPlan
  snapshot?: PortfolioSnapshot | null
  signals?: ProtocolSignals
  executionCost?: ExecutionCostEstimate | null
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

export function buildInvestmentCommittee(context: CommitteeContext): InvestmentCommittee {
  const nowMs = context.nowMs ?? Date.now()
  const generatedAt = new Date(nowMs).toISOString()
  const signals = context.signals ?? {}
  const plan = context.executionPlan
  const driftBps = Math.abs(Number(plan.currentStableBps - plan.targetStableBps))
  const marketStatus = freshnessStatus(context.snapshot?.updatedAt, nowMs, 15)
  const costStatus = plan.action === 'HOLD'
    ? 'READY'
    : freshnessStatus(context.executionCost?.observedAt, nowMs, 2)

  const reports: SpecialistReport[] = [
    report({
      agentId: 'market',
      name: 'Market analyst',
      remit: 'Spot price, reserve drift, volatility and depeg surveillance',
      cadenceMinutes: 5,
      dataAsOf: context.snapshot?.updatedAt,
      status: marketStatus,
      stance: marketStatus !== 'READY' ? 'BLOCK' : plan.action === 'HOLD' ? 'NEUTRAL' : 'SUPPORT',
      confidence: marketStatus === 'READY' ? 92 : 20,
      headline: marketStatus === 'READY'
        ? plan.action === 'HOLD' ? 'Reserve allocation remains inside its approved band.' : `${driftBps / 100}% reserve drift requires review.`
        : 'Live market snapshot is missing or stale.',
      findings: context.snapshot ? [
        `PancakeSwap spot quote: ${Number(context.snapshot.priceStablePerNative) / 1e18} BUSD per tBNB.`,
        `Reserve: ${Number(plan.currentStableBps) / 100}% current vs ${Number(plan.targetStableBps) / 100}% target.`,
      ] : [],
      missingInputs: marketStatus === 'READY' ? [] : ['Fresh wallet balances and PancakeSwap spot quote'],
      estimatedGrossBenefitBps: null,
      estimatedRiskCostBps: null,
    }, generatedAt),
    report({
      agentId: 'liquidity',
      name: 'LP analyst',
      remit: 'Pool depth, fee APR, range health and impermanent loss',
      cadenceMinutes: 10,
      dataAsOf: signals.liquidityObservedAt,
      status: signals.lpRangeDistanceBps === undefined && signals.impermanentLossBps === undefined && signals.liquidityChangeBps === undefined ? 'UNAVAILABLE' : freshnessStatus(signals.liquidityObservedAt, nowMs, 20),
      stance: signals.impermanentLossBps !== undefined && signals.impermanentLossBps >= context.strategy.guardrails.maximumImpermanentLossBps ? 'BLOCK' : 'NEUTRAL',
      confidence: signals.lpRangeDistanceBps === undefined ? 35 : 84,
      headline: signals.lpRangeDistanceBps === undefined ? 'No live Infinity position telemetry is connected.' : 'Infinity range and IL telemetry reviewed.',
      findings: [
        ...(signals.lpRangeDistanceBps === undefined ? [] : [`Range distance: ${signals.lpRangeDistanceBps / 100}%.`]),
        ...(signals.impermanentLossBps === undefined ? [] : [`Impermanent loss: ${signals.impermanentLossBps / 100}%.`]),
      ],
      missingInputs: signals.lpRangeDistanceBps === undefined ? ['Infinity positions, pool liquidity, fee APR and range state'] : [],
      estimatedGrossBenefitBps: signals.lpFeeAprBps ?? null,
      estimatedRiskCostBps: signals.impermanentLossBps ?? null,
    }, generatedAt),
    report({
      agentId: 'farms',
      name: 'Farm analyst',
      remit: 'Net incentives, emissions decay, lock terms and exit liquidity',
      cadenceMinutes: 30,
      dataAsOf: signals.farmObservedAt,
      status: signals.currentNetYieldBps === undefined ? 'UNAVAILABLE' : freshnessStatus(signals.farmObservedAt, nowMs, 45),
      stance: signals.currentNetYieldBps !== undefined && signals.bestAlternativeNetYieldBps !== undefined && signals.currentNetYieldBps < signals.bestAlternativeNetYieldBps ? 'CAUTION' : 'NEUTRAL',
      confidence: signals.currentNetYieldBps === undefined ? 30 : 80,
      headline: signals.currentNetYieldBps === undefined ? 'No live Universal Farms opportunity feed is connected.' : 'Farm rewards were compared after known costs.',
      findings: signals.currentNetYieldBps === undefined ? [] : [`Current net yield: ${signals.currentNetYieldBps / 100}%.`],
      missingInputs: signals.currentNetYieldBps === undefined ? ['Farm APR, emissions, lock duration and exit liquidity'] : [],
      estimatedGrossBenefitBps: signals.currentNetYieldBps ?? null,
      estimatedRiskCostBps: signals.farmRiskCostBps ?? null,
    }, generatedAt),
    report({
      agentId: 'earn',
      name: 'Earn analyst',
      remit: 'Vault APY, reward accrual, compounding threshold and withdrawal terms',
      cadenceMinutes: 60,
      dataAsOf: signals.earnObservedAt,
      status: signals.earnNetYieldBps === undefined ? 'UNAVAILABLE' : freshnessStatus(signals.earnObservedAt, nowMs, 90),
      stance: signals.earnNetYieldBps === undefined ? 'NEUTRAL' : signals.pendingRewardsValueBps !== undefined && signals.pendingRewardsValueBps < context.strategy.guardrails.minimumNetBenefitBps ? 'CAUTION' : 'SUPPORT',
      confidence: signals.earnNetYieldBps === undefined ? 30 : 80,
      headline: signals.earnNetYieldBps === undefined ? 'No live CAKE Earn vault feed is connected.' : 'Earn yield and compounding threshold reviewed.',
      findings: signals.earnNetYieldBps === undefined ? [] : [`Current net vault yield: ${signals.earnNetYieldBps / 100}%.`],
      missingInputs: signals.earnNetYieldBps === undefined ? ['Earn vault APY, rewards, lock and withdrawal state'] : [],
      estimatedGrossBenefitBps: signals.earnNetYieldBps ?? null,
      estimatedRiskCostBps: signals.earnRiskCostBps ?? null,
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
      estimatedGrossBenefitBps: null,
      estimatedRiskCostBps: context.executionCost?.totalCostBps ?? null,
    }, generatedAt),
  ]

  const readyAgents = reports.filter((item) => item.status === 'READY').length
  const staleAgents = reports.filter((item) => item.status === 'STALE').length
  const unavailableAgents = reports.filter((item) => item.status === 'UNAVAILABLE').length
  const grossCandidates = reports.flatMap((item) => item.estimatedGrossBenefitBps === null ? [] : [item.estimatedGrossBenefitBps])
  const grossBenefitBps = grossCandidates.length ? Math.max(...grossCandidates) : null
  const riskCostBps = reports.reduce((total, item) => total + (item.agentId === 'execution-cost' ? 0 : item.estimatedRiskCostBps ?? 0), 0)
  const executionCostBps = plan.action === 'HOLD' ? 0 : context.executionCost?.totalCostBps ?? null
  const netBenefitBps = grossBenefitBps !== null && executionCostBps !== null ? grossBenefitBps - riskCostBps - executionCostBps : null
  const costGatePassed = plan.action === 'HOLD' || (
    marketStatus === 'READY' &&
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
      ? 'The committee found no mandate breach requiring execution.'
      : costGatePassed
        ? 'Market evidence and live execution costs are inside the mandate cost ceiling.'
        : 'The committee withheld execution because cost evidence is missing, stale, or above the mandate ceiling.',
  }
}
