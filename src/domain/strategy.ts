import type { InvestmentGoal, RiskProfileId } from './portfolio'

export type LiquidityNeed = 'anytime' | 'weekly' | 'term'
export type StrategySleeveId = 'reserve' | 'market' | 'liquidity' | 'earn'
export type PancakeToolId = 'v2-router' | 'v2-liquidity' | 'masterchef-v2' | 'cake-pool'
export type ExecutionCoverage = 'LIVE'

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
  minimumActionCooldownMinutes: number
  maximumExecutionCostBps: number
  minimumNetBenefitBps: number
  leverageAllowed: false
}

export type StrategyPlan = {
  riskProfile: RiskProfileId
  sleeves: StrategySleeve[]
  actions: StrategyAction[]
  guardrails: StrategyGuardrails
  modelYieldBps: number
  riskScore: number
  reviewIntervalHours: number
  reviewCadence: string
  summary: string
}

const sleeveMeta: Record<StrategySleeveId, Omit<StrategySleeve, 'allocationBps'>> = {
  reserve: {
    id: 'reserve',
    name: 'Liquid reserve',
    color: 'var(--strategy-reserve)',
    purpose: 'Stable liquidity for withdrawals, gas, and defensive reallocation.',
    tool: 'v2-router',
  },
  market: {
    id: 'market',
    name: 'Market exposure',
    color: 'var(--strategy-market)',
    purpose: 'A diversified spot basket built with bounded PancakeSwap routes.',
    tool: 'v2-router',
  },
  liquidity: {
    id: 'liquidity',
    name: 'Liquidity yield',
    color: 'var(--strategy-liquidity)',
    purpose: 'Fee-generating CAKE/WBNB liquidity with position and IL limits.',
    tool: 'v2-liquidity',
  },
  earn: {
    id: 'earn',
    name: 'Farm and earn',
    color: 'var(--strategy-earn)',
    purpose: 'MasterChef incentives and flexible CAKE yield with explicit exits.',
    tool: 'masterchef-v2',
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
    minimumActionCooldownMinutes: 240,
    maximumExecutionCostBps: 300,
    minimumNetBenefitBps: 75,
    leverageAllowed: false,
  },
  balanced: {
    minimumReserveBps: 2_000,
    maximumLiquidityBps: 3_500,
    maximumSinglePositionBps: 2_500,
    maximumSlippageBps: 100,
    maximumImpermanentLossBps: 700,
    dailyTurnoverBps: 3_500,
    minimumActionCooldownMinutes: 120,
    maximumExecutionCostBps: 500,
    minimumNetBenefitBps: 50,
    leverageAllowed: false,
  },
  growth: {
    minimumReserveBps: 1_000,
    maximumLiquidityBps: 4_500,
    maximumSinglePositionBps: 3_500,
    maximumSlippageBps: 150,
    maximumImpermanentLossBps: 1_200,
    dailyTurnoverBps: 5_000,
    minimumActionCooldownMinutes: 60,
    maximumExecutionCostBps: 700,
    minimumNetBenefitBps: 35,
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
      tool: 'v2-router',
      title: 'Build the spot and reserve basket',
      detail: 'Route bounded swaps into the approved assets while preserving gas and withdrawal liquidity.',
      allocationBps: allocation.reserve + allocation.market,
      coverage: 'LIVE',
      risk: 'Low',
    },
    {
      id: 'open-liquidity',
      order: 2,
      tool: 'v2-liquidity',
      title: 'Open CAKE/WBNB liquidity',
      detail: 'Route the approved sleeve into the official testnet pair and mint an onchain LP position.',
      allocationBps: allocation.liquidity,
      coverage: 'LIVE',
      risk: risk === 'growth' ? 'High' : 'Medium',
    },
    {
      id: 'farm-position',
      order: 3,
      tool: 'masterchef-v2',
      title: 'Stake LP in MasterChef V2',
      detail: 'Deposit the minted CAKE/WBNB LP into official testnet Farm PID 4 and retain a typed withdrawal path.',
      allocationBps: allocation.liquidity,
      coverage: 'LIVE',
      risk: 'Medium',
    },
    {
      id: 'compound-rewards',
      order: 4,
      tool: 'cake-pool',
      title: 'Deposit CAKE into flexible Earn',
      detail: 'Convert the Earn sleeve to CAKE and deposit it into the official share-based CAKE Pool with no lock.',
      allocationBps: allocation.earn,
      coverage: 'LIVE',
      risk: 'Low',
    },
  ]

  const reviewIntervalHours = liquidityNeed === 'anytime' ? 4 : risk === 'growth' ? 8 : 24

  return {
    riskProfile: risk,
    sleeves,
    actions,
    guardrails,
    modelYieldBps,
    riskScore,
    reviewIntervalHours,
    reviewCadence: reviewIntervalHours === 24 ? 'Daily' : `Every ${reviewIntervalHours} hours`,
    summary: strategySummary(goal, risk),
  }
}

export function formatBps(value: number) {
  return `${(value / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
}

export function allocationFor(plan: StrategyPlan, id: StrategySleeveId) {
  return plan.sleeves.find((sleeve) => sleeve.id === id)?.allocationBps ?? 0
}
