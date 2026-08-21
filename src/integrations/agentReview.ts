import {
  agentReviewResponseSchema,
  assertStrategyPlan,
  serializePortfolioPlan,
  serializePortfolioSnapshot,
  type AgentReviewResponse,
} from '../domain/agentContracts'
import type { InvestmentCommittee } from '../domain/investmentCommittee'
import type { PortfolioPlan, PortfolioSnapshot } from '../domain/portfolio'
import type { StrategyPlan } from '../domain/strategy'
import type { ExpertRecommendation } from '../domain/assetManagerPrompt'
import type { ReviewSource } from '../domain/triggerEngine'

type DeepSeekReviewContext = {
  source: ReviewSource
  mandate: {
    goal: string
    riskProfile: string
    managedAmount: string
    horizonDays: number
    liquidityNeed: string
    expiry: number
  }
  strategy: StrategyPlan
  executionPlan: PortfolioPlan
  snapshot: PortfolioSnapshot
  activeTriggers: string[]
  baseCommittee: InvestmentCommittee
  fallbackRecommendation: ExpertRecommendation
}

function agentApiUrl() {
  const configured = import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, '')
  return configured ? `${configured}/api/strategy/review` : '/api/strategy/review'
}

export async function requestDeepSeekReview(context: DeepSeekReviewContext): Promise<AgentReviewResponse> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 65_000)
  try {
    const response = await fetch(agentApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...context,
        strategy: assertStrategyPlan(context.strategy),
        executionPlan: serializePortfolioPlan(context.executionPlan),
        snapshot: serializePortfolioSnapshot(context.snapshot),
      }),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Agent runtime returned ${response.status}.`
      throw new Error(message)
    }
    return agentReviewResponseSchema.parse(body)
  } finally {
    window.clearTimeout(timeout)
  }
}
