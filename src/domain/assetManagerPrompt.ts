import { z } from 'zod'
import type { InvestmentCommittee } from './investmentCommittee'
import type { PortfolioPlan } from './portfolio'
import type { StrategyPlan } from './strategy'

export const ASSET_MANAGER_PROMPT_VERSION = 'mandatefi.asset-manager.v2'

export const expertActionSchema = z.enum([
  'HOLD',
  'SWAP',
  'ADD_LIQUIDITY',
  'REMOVE_LIQUIDITY',
  'STAKE_FARM',
  'UNSTAKE_FARM',
  'HARVEST',
  'COMPOUND',
  'EMERGENCY_EXIT',
  'PAUSE',
])

export type ExpertAction = z.infer<typeof expertActionSchema>

export const expertRecommendationSchema = z.object({
  decision: z.enum(['HOLD', 'ADJUST', 'PAUSE']),
  action: expertActionSchema,
  confidence: z.number().int().min(0).max(100),
  rationale: z.string().min(1).max(600),
  expectedNetBenefitBps: z.number().int().nullable(),
  requiresApproval: z.boolean(),
}).strict()

export type ExpertRecommendation = z.infer<typeof expertRecommendationSchema>

export type AssetManagerPromptContext = {
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
  activeTriggers: string[]
  adapterCoverage: Record<string, string>
  committee?: InvestmentCommittee
}

export function buildAssetManagerPrompt(context: AssetManagerPromptContext) {
  const payload = {
    mandate: context.mandate,
    targetAllocations: Object.fromEntries(
      context.strategy.sleeves.map((sleeve) => [sleeve.id, sleeve.allocationBps]),
    ),
    hardGuardrails: context.strategy.guardrails,
    currentPortfolio: {
      currentReserveBps: Number(context.executionPlan.currentStableBps),
      targetReserveBps: Number(context.executionPlan.targetStableBps),
      projectedReserveBps: Number(context.executionPlan.projectedStableBps),
      proposedSwapAction: context.executionPlan.action,
      proposedAmountIn: context.executionPlan.amountIn.toString(),
      inputAsset: context.executionPlan.inputAsset,
      outputAsset: context.executionPlan.outputAsset,
    },
    activeTriggers: context.activeTriggers,
    adapterCoverage: context.adapterCoverage,
    investmentCommittee: context.committee ?? null,
  }

  return `You are MandateFi's non-custodial DeFi portfolio manager and chair of its investment committee.

Objective:
- Improve risk-adjusted net returns for the owner's portfolio.
- Preserve the exact owner mandate, liquidity requirement, expiry, and hard guardrails.
- Use only approved PancakeSwap tools and typed actions exposed by the execution adapters.

Non-negotiable rules:
- Never use leverage, borrowing, bridging, unapproved assets, arbitrary calldata, or a new protocol.
- Never exceed reserve, position, liquidity, turnover, slippage, impermanent-loss, or expiry limits.
- Account for gas, price impact, slippage, lock duration, pool liquidity, and impermanent loss.
- Recommend an adjustment only when expected net benefit exceeds execution cost plus a safety margin.
- If evidence is missing, contradictory, stale, or outside adapter coverage, HOLD or require approval.
- You recommend actions only. The deterministic policy gate makes the final execution decision.
- Treat each specialist report as independent evidence. Never invent missing LP, Farm, Earn, or cost data.
- Resolve disagreement explicitly and prefer HOLD when the relevant specialist is stale or unavailable.

Allowed actions:
HOLD, SWAP, ADD_LIQUIDITY, REMOVE_LIQUIDITY, STAKE_FARM, UNSTAKE_FARM, HARVEST, COMPOUND, EMERGENCY_EXIT, PAUSE.

Current mandate and portfolio context:
${JSON.stringify(payload, null, 2)}

Return strict JSON only, with exactly these fields:
{
  "decision": "HOLD" | "ADJUST" | "PAUSE",
  "action": one allowed action,
  "confidence": integer from 0 to 100,
  "rationale": concise evidence-based explanation,
  "expectedNetBenefitBps": integer or null,
  "requiresApproval": boolean
}`
}
