import type { InvestmentGoal, RiskProfileId } from './portfolio'

export type LiquidityNeed = 'anytime' | 'weekly' | 'term'
export type StrategySleeveId = 'reserve' | 'market' | 'liquidity' | 'earn'
export type PancakeToolId = 'smart-router' | 'infinity-liquidity' | 'universal-farms' | 'cake-earn'
export type ExecutionCoverage = 'LIVE' | 'APPROVAL_REQUIRED' | 'ADAPTER_PLANNED'

export type StrategySleeve = {
  id: StrategySleeveId
  name: string
  allocationBps: number
  color: string
  purpose: string
  tool: PancakeToolId
}

export type StrategyAction = {
  id: string
  order: number
  tool: PancakeToolId
  title: string
  detail: string
  allocationBps: number
  coverage: ExecutionCoverage
  risk: 'Low' | 'Medium' | 'High'
}

export type StrategyGuardrails = {
  minimumReserveBps: number
  maximumLiquidityBps: number
  maximumSinglePositionBps: number
  maximumSlippageBps: number
  maximumImpermanentLossBps: number
  dailyTurnoverBps: number
  leverageAllowed: false
}

export type StrategyPlan = {
  sleeves: StrategySleeve[]
  actions: StrategyAction[]
  guardrails: StrategyGuardrails
  modelYieldBps: number
  riskScore: number
  reviewCadence: string
  summary: string
}

const sleeveMeta: Record<StrategySleeveId, Omit<StrategySleeve, 'allocationBps'>> = {
  reserve: {
    id: 'reserve',
    name: 'Liquid reserve',
    color: 'var(--strategy-reserve)',
    purpose: 'Stable liquidity for withdrawals, gas, and defensive reallocation.',
    tool: 'smart-router',
  },
  market: {
    id: 'market',
    name: 'Market exposure',
    color: 'var(--strategy-market)',
    purpose: 'A diversified spot basket built with bounded PancakeSwap routes.',
    tool: 'smart-router',
  },
  liquidity: {
    id: 'liquidity',
    name: 'Liquidity yield',
    color: 'var(--strategy-liquidity)',
    purpose: 'Fee-generating concentrated liquidity with range and IL limits.',
    tool: 'infinity-liquidity',
  },
  earn: {
    id: 'earn',
    name: 'Farm and earn',
    color: 'var(--strategy-earn)',
    purpose: 'Farm incentives and single-token yield with lock-aware sizing.',
    tool: 'universal-farms',
  },
}

const profileAllocation: Record<RiskProfileId, Record<StrategySleeveId, number>> = {
  conservative: { reserve: 5_000, market: 1_500, liquidity: 2_000, earn: 1_500 },
  balanced: { reserve: 2_500, market: 3_000, liquidity: 3_000, earn: 1_500 },
  growth: { reserve: 1_000, market: 4_500, liquidity: 3_500, earn: 1_000 },
}

const profileGuardrails: Record<RiskProfileId, StrategyGuardrails> = {
  conservative: {
    minimumReserveBps: 4_000,
    maximumLiquidityBps: 2_500,
    maximumSinglePositionBps: 1_500,
    maximumSlippageBps: 50,
    maximumImpermanentLossBps: 300,
    dailyTurnoverBps: 2_000,
    leverageAllowed: false,
  },
  balanced: {
    minimumReserveBps: 2_000,
    maximumLiquidityBps: 3_500,
    maximumSinglePositionBps: 2_500,
    maximumSlippageBps: 100,
    maximumImpermanentLossBps: 700,
    dailyTurnoverBps: 3_500,
    leverageAllowed: false,
  },
  growth: {
    minimumReserveBps: 1_000,
    maximumLiquidityBps: 4_500,
    maximumSinglePositionBps: 3_500,
    maximumSlippageBps: 150,
    maximumImpermanentLossBps: 1_200,
    dailyTurnoverBps: 5_000,
    leverageAllowed: false,
  },
}

function transfer(
  allocation: Record<StrategySleeveId, number>,
  from: StrategySleeveId,
  to: StrategySleeveId,
  amount: number,
) {
  const moved = Math.min(allocation[from], amount)
  allocation[from] -= moved
  allocation[to] += moved
}

function strategySummary(goal: InvestmentGoal, risk: RiskProfileId) {
  if (goal === 'preserve') return 'Defensive income with a larger liquid reserve and tightly capped LP exposure.'
  if (goal === 'maximize-growth') return 'Growth-led spot and liquidity exposure with a permanent reserve and no leverage.'
  return risk === 'conservative'
    ? 'Balanced income with conservative position sizing and fast liquidity.'
    : 'Diversified growth and yield across spot, liquidity, and farming positions.'
}

export function buildStrategyPlan({
  goal,
  risk,
  liquidityNeed,
  horizonDays,
}: {
  goal: InvestmentGoal
  risk: RiskProfileId
  liquidityNeed: LiquidityNeed
  horizonDays: number
}): StrategyPlan {
  const allocation = { ...profileAllocation[risk] }

  if (goal === 'preserve') {
    transfer(allocation, 'market', 'reserve', 700)
    transfer(allocation, 'liquidity', 'reserve', 300)
  } else if (goal === 'maximize-growth') {
    transfer(allocation, 'reserve', 'market', 500)
    transfer(allocation, 'earn', 'liquidity', 500)
  }

  if (liquidityNeed === 'anytime') {
    transfer(allocation, 'market', 'reserve', 400)
    transfer(allocation, 'liquidity', 'reserve', 400)
    transfer(allocation, 'earn', 'reserve', 200)
  } else if (liquidityNeed === 'term') {
    transfer(allocation, 'reserve', 'liquidity', 300)
    transfer(allocation, 'reserve', 'earn', 200)
  }

  if (horizonDays <= 7) {
    transfer(allocation, 'liquidity', 'reserve', 300)
    transfer(allocation, 'earn', 'reserve', 200)
  } else if (horizonDays >= 30) {
    transfer(allocation, 'reserve', 'liquidity', 200)
    transfer(allocation, 'market', 'earn', 100)
  }

  const guardrails = profileGuardrails[risk]
  if (allocation.reserve < guardrails.minimumReserveBps) {
    const deficit = guardrails.minimumReserveBps - allocation.reserve
    transfer(allocation, 'market', 'reserve', deficit)
  }
  if (allocation.liquidity > guardrails.maximumLiquidityBps) {
    transfer(allocation, 'liquidity', 'reserve', allocation.liquidity - guardrails.maximumLiquidityBps)
  }

  const sleeves = (Object.keys(sleeveMeta) as StrategySleeveId[]).map((id) => ({
    ...sleeveMeta[id],
    allocationBps: allocation[id],
  }))

  const modelYieldBps = Math.round(
    allocation.reserve * 220 / 10_000 +
    allocation.liquidity * 1_380 / 10_000 +
    allocation.earn * 840 / 10_000,
  )
  const riskScore = Math.min(10, Math.max(1, Math.round(
    (allocation.market * 6 + allocation.liquidity * 8 + allocation.earn * 4 + allocation.reserve) / 10_000,
  )))

  const actions: StrategyAction[] = [
    {
      id: 'build-basket',
      order: 1,
      tool: 'smart-router',
      title: 'Build the spot and reserve basket',
      detail: 'Route bounded swaps into the approved assets while preserving gas and withdrawal liquidity.',
      allocationBps: allocation.reserve + allocation.market,
      coverage: 'LIVE',
      risk: 'Low',
    },
    {
      id: 'open-liquidity',
      order: 2,
      tool: 'infinity-liquidity',
      title: 'Open concentrated liquidity positions',
      detail: 'Select deep pairs and ranges only when fee yield clears volatility and impermanent-loss limits.',
      allocationBps: allocation.liquidity,
      coverage: 'APPROVAL_REQUIRED',
      risk: risk === 'growth' ? 'High' : 'Medium',
    },
    {
      id: 'farm-position',
      order: 3,
      tool: 'universal-farms',
      title: 'Stake eligible liquidity in Farms',
      detail: 'Add CAKE incentives only after fees, emissions, lock terms, and exit liquidity pass policy checks.',
      allocationBps: Math.round(allocation.earn * 0.65),
      coverage: 'ADAPTER_PLANNED',
      risk: 'Medium',
    },
    {
      id: 'compound-rewards',
      order: 4,
      tool: 'cake-earn',
      title: 'Harvest and compound rewards',
      detail: 'Compound above the gas threshold; otherwise retain rewards until the next scheduled review.',
      allocationBps: Math.round(allocation.earn * 0.35),
      coverage: 'ADAPTER_PLANNED',
      risk: 'Low',
    },
  ]

  return {
    sleeves,
    actions,
    guardrails,
    modelYieldBps,
    riskScore,
    reviewCadence: liquidityNeed === 'anytime' ? 'Every 4 hours' : risk === 'growth' ? 'Every 8 hours' : 'Daily',
    summary: strategySummary(goal, risk),
  }
}

export function formatBps(value: number) {
  return `${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

export function allocationFor(plan: StrategyPlan, id: StrategySleeveId) {
  return plan.sleeves.find((sleeve) => sleeve.id === id)?.allocationBps ?? 0
}
