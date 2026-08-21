import { z } from 'zod'
import type { PortfolioPlan, PortfolioSnapshot } from './portfolio.js'
import type { StrategyPlan } from './strategy.js'

export const specialistAgentIdSchema = z.enum(['market', 'liquidity', 'farms', 'earn', 'execution-cost'])
export const agentStanceSchema = z.enum(['SUPPORT', 'NEUTRAL', 'CAUTION', 'BLOCK'])
export const agentDataStatusSchema = z.enum(['READY', 'STALE', 'UNAVAILABLE'])
export const agentModelModeSchema = z.enum(['DEEPSEEK', 'DETERMINISTIC_FALLBACK'])

const confidenceScoreSchema = z.number().finite().min(0).max(100).transform((value) => {
  const percentage = value > 0 && value <= 1 ? value * 100 : value
  return Math.round(percentage)
})

export const specialistJudgementOutputSchema = z.object({
  stance: agentStanceSchema,
  confidence: confidenceScoreSchema,
  headline: z.string().min(1).max(240),
  findings: z.array(z.string().min(1).max(320)).max(4),
  missingInputs: z.array(z.string().min(1).max(240)).max(4),
}).strict()

export const expertRecommendationOutputSchema = z.object({
  decision: z.enum(['HOLD', 'ADJUST', 'PAUSE']),
  action: z.enum([
    'HOLD', 'SWAP', 'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY', 'STAKE_FARM',
    'UNSTAKE_FARM', 'HARVEST', 'COMPOUND', 'EMERGENCY_EXIT', 'PAUSE',
  ]),
  confidence: confidenceScoreSchema,
  rationale: z.string().min(1).max(600),
  expectedNetBenefitBps: z.number().int().nullable(),
  requiresApproval: z.boolean(),
}).strict()

const strategySleeveSchema = z.object({
  id: z.enum(['reserve', 'market', 'liquidity', 'earn']),
  name: z.string(),
  allocationBps: z.number().int().min(0).max(10_000),
  color: z.string(),
  purpose: z.string(),
  tool: z.enum(['smart-router', 'infinity-liquidity', 'universal-farms', 'cake-earn']),
}).strict()

const strategyActionSchema = z.object({
  id: z.string(),
  order: z.number().int().positive(),
  tool: z.enum(['smart-router', 'infinity-liquidity', 'universal-farms', 'cake-earn']),
  title: z.string(),
  detail: z.string(),
  allocationBps: z.number().int().min(0).max(10_000),
  coverage: z.enum(['LIVE', 'APPROVAL_REQUIRED', 'ADAPTER_PLANNED']),
  risk: z.enum(['Low', 'Medium', 'High']),
}).strict()

export const strategyPlanSchema = z.object({
  riskProfile: z.enum(['conservative', 'balanced', 'growth']),
  sleeves: z.array(strategySleeveSchema).length(4),
  actions: z.array(strategyActionSchema),
  guardrails: z.object({
    minimumReserveBps: z.number().int().min(0).max(10_000),
    maximumLiquidityBps: z.number().int().min(0).max(10_000),
    maximumSinglePositionBps: z.number().int().min(0).max(10_000),
    maximumSlippageBps: z.number().int().nonnegative(),
    maximumImpermanentLossBps: z.number().int().nonnegative(),
    dailyTurnoverBps: z.number().int().min(0).max(10_000),
    minimumActionCooldownMinutes: z.number().int().nonnegative(),
    maximumExecutionCostBps: z.number().int().nonnegative(),
    minimumNetBenefitBps: z.number().int().nonnegative(),
    leverageAllowed: z.literal(false),
  }).strict(),
  modelYieldBps: z.number().int(),
  riskScore: z.number().int().min(1).max(10),
  reviewIntervalHours: z.number().positive(),
  reviewCadence: z.string(),
  summary: z.string(),
}).strict()

export const serializedPortfolioPlanSchema = z.object({
  action: z.enum(['BUY_STABLE', 'BUY_NATIVE', 'HOLD']),
  purpose: z.enum(['PORTFOLIO_REBALANCE', 'GAS_TOP_UP']),
  stablecoin: z.enum(['USDT', 'USDC']),
  managedAmount: z.string().regex(/^\d+$/),
  managedValue: z.string().regex(/^\d+$/),
  availableNative: z.string().regex(/^\d+$/),
  nativeValueInStable: z.string().regex(/^\d+$/),
  priceStablePerNative: z.string().regex(/^\d+$/),
  currentStableBps: z.string().regex(/^\d+$/),
  targetStableBps: z.string().regex(/^\d+$/),
  projectedStableBps: z.string().regex(/^\d+$/),
  driftBandBps: z.string().regex(/^\d+$/),
  amountIn: z.string().regex(/^\d+$/),
  inputAsset: z.enum(['tBNB', 'USDT', 'USDC']),
  outputAsset: z.enum(['tBNB', 'USDT', 'USDC']),
  maxSlippageBps: z.string().regex(/^\d+$/),
  dailyNativeCap: z.string().regex(/^\d+$/),
  dailyStableCap: z.string().regex(/^\d+$/),
  rationale: z.string(),
}).strict()

export const serializedPortfolioSnapshotSchema = z.object({
  nativeBalance: z.string().regex(/^\d+$/),
  stableBalance: z.string().regex(/^\d+$/),
  stablecoin: z.enum(['USDT', 'USDC']),
  priceStablePerNative: z.string().regex(/^\d+$/),
  updatedAt: z.iso.datetime(),
}).strict()

const inferenceSchema = z.object({
  mode: agentModelModeSchema,
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  latencyMs: z.number().int().nonnegative(),
}).strict()

export const specialistReportSchema = z.object({
  agentId: specialistAgentIdSchema,
  name: z.string(),
  remit: z.string(),
  cadenceMinutes: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  dataAsOf: z.iso.datetime().optional(),
  status: agentDataStatusSchema,
  stance: agentStanceSchema,
  confidence: z.number().int().min(0).max(100),
  headline: z.string(),
  findings: z.array(z.string()),
  missingInputs: z.array(z.string()),
  sourceLabel: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  estimatedGrossBenefitBps: z.number().int().nullable(),
  estimatedRiskCostBps: z.number().int().nullable(),
  inference: inferenceSchema.optional(),
}).strict()

export const investmentCommitteeSchema = z.object({
  generatedAt: z.iso.datetime(),
  reports: z.array(specialistReportSchema).length(5),
  readyAgents: z.number().int().min(0).max(5),
  staleAgents: z.number().int().min(0).max(5),
  unavailableAgents: z.number().int().min(0).max(5),
  grossBenefitBps: z.number().int().nullable(),
  riskCostBps: z.number().int(),
  executionCostBps: z.number().int().nullable(),
  netBenefitBps: z.number().int().nullable(),
  minimumNetBenefitBps: z.number().int().nonnegative(),
  costGatePassed: z.boolean(),
  dissentingAgents: z.array(specialistAgentIdSchema),
  summary: z.string(),
  modelMode: z.enum(['DEEPSEEK', 'HYBRID_FALLBACK', 'DETERMINISTIC_FALLBACK']).optional(),
  runId: z.string().optional(),
}).strict()

export const agentReviewRequestSchema = z.object({
  source: z.enum(['ACTIVATION', 'MANUAL', 'MONITOR']),
  mandate: z.object({
    goal: z.string().min(1),
    riskProfile: z.string().min(1),
    stablecoin: z.enum(['USDT', 'USDC']),
    managedAmount: z.string().min(1),
    horizonDays: z.number().int().positive(),
    liquidityNeed: z.string().min(1),
    expiry: z.number().int().positive(),
  }).strict(),
  strategy: strategyPlanSchema,
  executionPlan: serializedPortfolioPlanSchema,
  snapshot: serializedPortfolioSnapshotSchema,
  activeTriggers: z.array(z.string().min(1)).max(16),
  baseCommittee: investmentCommitteeSchema,
  fallbackRecommendation: expertRecommendationOutputSchema,
}).strict()

export const agentReviewResponseSchema = z.object({
  runId: z.string().min(1),
  generatedAt: z.iso.datetime(),
  modelMode: z.enum(['DEEPSEEK', 'HYBRID_FALLBACK', 'DETERMINISTIC_FALLBACK']),
  managerModel: z.string().min(1),
  promptVersion: z.string().min(1),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  committee: investmentCommitteeSchema,
  recommendation: expertRecommendationOutputSchema,
  auditPersistence: z.enum(['postgres', 'vercel-log']),
}).strict()

export type AgentReviewRequest = z.infer<typeof agentReviewRequestSchema>
export type AgentReviewResponse = z.infer<typeof agentReviewResponseSchema>
export type SpecialistJudgementOutput = z.infer<typeof specialistJudgementOutputSchema>

export function serializePortfolioPlan(plan: PortfolioPlan): z.infer<typeof serializedPortfolioPlanSchema> {
  return {
    ...plan,
    managedAmount: plan.managedAmount.toString(),
    managedValue: plan.managedValue.toString(),
    availableNative: plan.availableNative.toString(),
    nativeValueInStable: plan.nativeValueInStable.toString(),
    priceStablePerNative: plan.priceStablePerNative.toString(),
    currentStableBps: plan.currentStableBps.toString(),
    targetStableBps: plan.targetStableBps.toString(),
    projectedStableBps: plan.projectedStableBps.toString(),
    driftBandBps: plan.driftBandBps.toString(),
    amountIn: plan.amountIn.toString(),
    maxSlippageBps: plan.maxSlippageBps.toString(),
    dailyNativeCap: plan.dailyNativeCap.toString(),
    dailyStableCap: plan.dailyStableCap.toString(),
  }
}

export function deserializePortfolioPlan(plan: z.infer<typeof serializedPortfolioPlanSchema>): PortfolioPlan {
  return {
    ...plan,
    managedAmount: BigInt(plan.managedAmount),
    managedValue: BigInt(plan.managedValue),
    availableNative: BigInt(plan.availableNative),
    nativeValueInStable: BigInt(plan.nativeValueInStable),
    priceStablePerNative: BigInt(plan.priceStablePerNative),
    currentStableBps: BigInt(plan.currentStableBps),
    targetStableBps: BigInt(plan.targetStableBps),
    projectedStableBps: BigInt(plan.projectedStableBps),
    driftBandBps: BigInt(plan.driftBandBps),
    amountIn: BigInt(plan.amountIn),
    maxSlippageBps: BigInt(plan.maxSlippageBps),
    dailyNativeCap: BigInt(plan.dailyNativeCap),
    dailyStableCap: BigInt(plan.dailyStableCap),
  }
}

export function serializePortfolioSnapshot(snapshot: PortfolioSnapshot): z.infer<typeof serializedPortfolioSnapshotSchema> {
  return {
    nativeBalance: snapshot.nativeBalance.toString(),
    stableBalance: snapshot.stableBalance.toString(),
    stablecoin: snapshot.stablecoin,
    priceStablePerNative: snapshot.priceStablePerNative.toString(),
    updatedAt: snapshot.updatedAt,
  }
}

export function assertStrategyPlan(plan: StrategyPlan) {
  return strategyPlanSchema.parse(plan)
}
