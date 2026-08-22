import { z } from 'zod'
import type { PancakeMarketSnapshot } from '../integrations/pancakeMarket.js'
import type { PancakeResearchSnapshot } from '../integrations/pancakeResearch.js'
import type { StablecoinSymbol } from '../lib/tokens.js'
import type { InvestmentGoal, RiskProfileId } from './portfolio.js'
import type { LiquidityNeed } from './strategy.js'

export const STABLECOIN_ALLOCATOR_PROMPT_VERSION = 'mandatefi.stablecoin-allocator.v1'

export const stablecoinCandidateSchema = z.object({
  symbol: z.enum(['USDT', 'USDC']),
  priceUsd: z.number().positive(),
  pegDeviationBps: z.number().int().nonnegative(),
  bestOpportunityType: z.enum(['LIQUIDITY', 'FARM', 'NONE']),
  bestOpportunityPair: z.string(),
  bestOpportunityAprBps: z.number().int().nonnegative(),
  bestOpportunityTvlUsd: z.number().int().nonnegative(),
  eligibleOpportunityCount: z.number().int().nonnegative(),
  riskAdjustedScore: z.number().int(),
  testnetOutputPerTbnb: z.number().nonnegative().nullable(),
}).strict()

export const stablecoinSelectionRequestSchema = z.object({
  goal: z.enum(['preserve', 'balanced-growth', 'maximize-growth']),
  riskProfile: z.enum(['conservative', 'balanced', 'growth']),
  liquidityNeed: z.enum(['anytime', 'weekly', 'term']),
  horizonDays: z.number().int().positive(),
  marketObservedAt: z.iso.datetime(),
  researchObservedAt: z.iso.datetime(),
  candidates: z.array(stablecoinCandidateSchema).length(2),
}).strict()

export const stablecoinSelectionOutputSchema = z.object({
  stablecoin: z.enum(['USDT', 'USDC']),
  confidence: z.number().int().min(0).max(100),
  rationale: z.string().min(1).max(600),
  keyFactors: z.array(z.string().min(1).max(180)).min(1).max(4),
}).strict()

export const stablecoinSelectionResponseSchema = stablecoinSelectionOutputSchema.extend({
  generatedAt: z.iso.datetime(),
  modelMode: z.enum(['DEEPSEEK', 'DETERMINISTIC_FALLBACK']),
  modelName: z.string().min(1),
  promptVersion: z.literal(STABLECOIN_ALLOCATOR_PROMPT_VERSION),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/),
  candidates: z.array(stablecoinCandidateSchema).length(2),
}).strict()

export type StablecoinCandidate = z.infer<typeof stablecoinCandidateSchema>
export type StablecoinSelectionRequest = z.infer<typeof stablecoinSelectionRequestSchema>
export type StablecoinSelectionOutput = z.infer<typeof stablecoinSelectionOutputSchema>
export type StablecoinSelectionEvidence = z.infer<typeof stablecoinSelectionResponseSchema>

type QuoteRates = Partial<Record<StablecoinSymbol, number | null>>

const stableSymbols = new Set(['USDT', 'USDC'])
const blueChipSymbols = new Set(['USDT', 'USDC', 'WBNB', 'BTCB', 'ETH'])

function pairSymbols(pair: string) {
  return pair.toUpperCase().split('/')
}

function eligiblePair(pair: string, tvlUsd: number, symbol: StablecoinSymbol, risk: RiskProfileId) {
  const symbols = pairSymbols(pair)
  if (!symbols.includes(symbol)) return false
  if (risk === 'conservative') {
    return symbols.every((item) => stableSymbols.has(item)) && tvlUsd >= 5_000_000
  }
  if (risk === 'balanced') {
    return symbols.every((item) => blueChipSymbols.has(item)) && tvlUsd >= 1_000_000
  }
  return tvlUsd >= 250_000
}

function opportunityScore(aprBps: number, tvlUsd: number, risk: RiskProfileId) {
  const liquidityWeight = risk === 'conservative' ? 1_200 : risk === 'balanced' ? 500 : 200
  return Math.round(aprBps + Math.log10(Math.max(tvlUsd, 1)) * liquidityWeight)
}

function candidateFor(
  symbol: StablecoinSymbol,
  research: PancakeResearchSnapshot,
  market: PancakeMarketSnapshot,
  risk: RiskProfileId,
  quoteRates: QuoteRates,
): StablecoinCandidate {
  const liquidity = research.liquidity.opportunities
    .filter((item) => eligiblePair(item.pair, item.tvlUsd, symbol, risk))
    .map((item) => ({ type: 'LIQUIDITY' as const, pair: item.pair, aprBps: item.feeAprBps, tvlUsd: item.tvlUsd }))
  const farms = research.farms.opportunities
    .filter((item) => eligiblePair(item.pair, item.tvlUsd, symbol, risk))
    .map((item) => ({ type: 'FARM' as const, pair: item.pair, aprBps: item.totalAprBps, tvlUsd: item.tvlUsd }))
  const eligible = [...liquidity, ...farms]
    .sort((a, b) => opportunityScore(b.aprBps, b.tvlUsd, risk) - opportunityScore(a.aprBps, a.tvlUsd, risk))
  const best = eligible[0]
  const priceUsd = symbol === 'USDT' ? market.pricesUsd.usdt : market.pricesUsd.usdc
  const pegDeviationBps = Math.round(Math.abs(priceUsd - 1) * 10_000)
  const pegPenalty = pegDeviationBps * (risk === 'conservative' ? 120 : risk === 'balanced' ? 80 : 50)
  const routeRate = quoteRates[symbol] ?? null
  const routeBonus = routeRate === null ? 0 : Math.min(500, Math.round(routeRate))
  const riskAdjustedScore = (best ? opportunityScore(best.aprBps, best.tvlUsd, risk) : 0) - pegPenalty + routeBonus

  return stablecoinCandidateSchema.parse({
    symbol,
    priceUsd,
    pegDeviationBps,
    bestOpportunityType: best?.type ?? 'NONE',
    bestOpportunityPair: best?.pair ?? 'No eligible opportunity',
    bestOpportunityAprBps: best?.aprBps ?? 0,
    bestOpportunityTvlUsd: best?.tvlUsd ?? 0,
    eligibleOpportunityCount: eligible.length,
    riskAdjustedScore,
    testnetOutputPerTbnb: routeRate,
  })
}

export function buildStablecoinSelectionRequest(input: {
  goal: InvestmentGoal
  riskProfile: RiskProfileId
  liquidityNeed: LiquidityNeed
  horizonDays: number
  market: PancakeMarketSnapshot
  research: PancakeResearchSnapshot
  quoteRates?: QuoteRates
}): StablecoinSelectionRequest {
  return stablecoinSelectionRequestSchema.parse({
    goal: input.goal,
    riskProfile: input.riskProfile,
    liquidityNeed: input.liquidityNeed,
    horizonDays: input.horizonDays,
    marketObservedAt: input.market.observedAt,
    researchObservedAt: input.research.generatedAt,
    candidates: (['USDT', 'USDC'] as const).map((symbol) => candidateFor(
      symbol,
      input.research,
      input.market,
      input.riskProfile,
      input.quoteRates ?? {},
    )),
  })
}

export function deterministicStablecoinSelection(input: StablecoinSelectionRequest): StablecoinSelectionOutput {
  const ranked = [...input.candidates].sort((a, b) => {
    if (b.riskAdjustedScore !== a.riskAdjustedScore) return b.riskAdjustedScore - a.riskAdjustedScore
    if (a.pegDeviationBps !== b.pegDeviationBps) return a.pegDeviationBps - b.pegDeviationBps
    if (b.bestOpportunityTvlUsd !== a.bestOpportunityTvlUsd) return b.bestOpportunityTvlUsd - a.bestOpportunityTvlUsd
    return a.symbol.localeCompare(b.symbol)
  })
  const selected = ranked[0]
  const alternative = ranked[1]
  if (!selected || !alternative) throw new Error('Both stablecoin candidates are required.')
  const scoreGap = Math.max(0, selected.riskAdjustedScore - alternative.riskAdjustedScore)
  const confidence = Math.min(92, 62 + Math.round(scoreGap / 250))
  const apr = (selected.bestOpportunityAprBps / 100).toFixed(2)
  const tvl = selected.bestOpportunityTvlUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })

  return stablecoinSelectionOutputSchema.parse({
    stablecoin: selected.symbol,
    confidence,
    rationale: `${selected.symbol} offers the stronger risk-adjusted base for this mandate. Its best eligible PancakeSwap opportunity is ${selected.bestOpportunityPair} at an observed ${apr}% APR with $${tvl} TVL, while peg deviation is ${selected.pegDeviationBps} bps.`,
    keyFactors: [
      `Observed opportunity: ${selected.bestOpportunityPair} · ${apr}% APR`,
      `Liquidity depth: $${tvl} TVL`,
      `Peg deviation: ${selected.pegDeviationBps} bps`,
      alternative.riskAdjustedScore === selected.riskAdjustedScore
        ? `Tie resolved by peg stability and liquidity depth versus ${alternative.symbol}`
        : `Risk-adjusted score leads ${alternative.symbol} by ${scoreGap.toLocaleString('en-US')} points`,
    ],
  })
}

export function buildStablecoinAllocatorPrompt(input: StablecoinSelectionRequest) {
  return `You are MandateFi's stablecoin allocation agent. Choose the portfolio base asset before any wallet permission is granted.

Choose exactly one asset: USDT or USDC.

Decision rules:
- Optimize risk-adjusted net opportunity, not headline APR alone.
- Respect the owner's risk profile, liquidity need, and horizon.
- Penalize peg deviation, shallow TVL, limited eligible opportunities, and missing execution quotes.
- Treat APR as a current observation, never a forecast or guarantee.
- Do not invent protocols, pools, yields, prices, or execution routes.
- The deterministic permission layer will authorize only the chosen asset.

Verified candidate evidence:
${JSON.stringify(input, null, 2)}

Return strict JSON only:
{
  "stablecoin": "USDT" | "USDC",
  "confidence": integer from 0 to 100,
  "rationale": concise evidence-based comparison,
  "keyFactors": 1 to 4 concise strings
}`
}
