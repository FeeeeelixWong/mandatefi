import { z } from 'zod'
import type { RiskProfileId } from '../domain/portfolio.js'

const urlSchema = z.string().url()

const poolOpportunitySchema = z.object({
  id: z.string().min(1),
  pair: z.string().min(3),
  protocol: z.string().min(1),
  token0Address: z.string().regex(/^0x[0-9a-f]{40}$/),
  token1Address: z.string().regex(/^0x[0-9a-f]{40}$/),
  feeTierBps: z.number().int().nonnegative().nullable(),
  tvlUsd: z.number().int().nonnegative(),
  volumeUsd24h: z.number().int().nonnegative(),
  feeAprBps: z.number().int().nonnegative(),
  link: urlSchema,
})

const farmOpportunitySchema = poolOpportunitySchema.extend({
  pid: z.number().int().nonnegative(),
  rewardAprBps: z.number().int().nonnegative(),
  totalAprBps: z.number().int().nonnegative(),
  rewardToken: z.literal('CAKE'),
})

const earnOpportunitySchema = z.object({
  id: z.string().min(1),
  contractAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
  stakeSymbol: z.string().min(1),
  earnSymbol: z.string().min(1),
  tvlUsd: z.number().int().positive(),
  rewardAprBps: z.number().int().nonnegative(),
  withdrawal: z.string().min(1),
  link: urlSchema,
})

export const pancakeResearchSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  network: z.object({ name: z.literal('BNB Chain mainnet'), chainId: z.literal(56) }),
  methodology: z.object({
    tokenUniverse: z.array(z.string().min(1)).min(1),
    minimumTvlUsd: z.number().positive(),
    note: z.string().min(1),
  }),
  liquidity: z.object({ observedAt: z.iso.datetime(), opportunities: z.array(poolOpportunitySchema) }),
  farms: z.object({ observedAt: z.iso.datetime(), opportunities: z.array(farmOpportunitySchema) }),
  earn: z.object({ observedAt: z.iso.datetime(), opportunities: z.array(earnOpportunitySchema) }),
  sources: z.array(z.object({ label: z.string().min(1), url: urlSchema })).min(1),
})

export type PancakeResearchSnapshot = z.infer<typeof pancakeResearchSchema>
export type PoolOpportunity = z.infer<typeof poolOpportunitySchema>
export type FarmOpportunity = z.infer<typeof farmOpportunitySchema>
export type EarnOpportunity = z.infer<typeof earnOpportunitySchema>

const stableSymbols = new Set(['USDT', 'USDC'])
const blueChipSymbols = new Set(['USDT', 'USDC', 'WBNB', 'BTCB', 'ETH'])

function pairSymbols(pair: string) {
  return pair.split('/').map((symbol) => symbol.toUpperCase())
}

function opportunityFitsRisk(opportunity: PoolOpportunity, risk: RiskProfileId) {
  const symbols = pairSymbols(opportunity.pair)
  if (risk === 'conservative') {
    return symbols.every((symbol) => stableSymbols.has(symbol)) && opportunity.tvlUsd >= 5_000_000
  }
  if (risk === 'balanced') {
    return symbols.every((symbol) => blueChipSymbols.has(symbol)) &&
      symbols.some((symbol) => stableSymbols.has(symbol)) &&
      opportunity.tvlUsd >= 2_000_000
  }
  return opportunity.tvlUsd >= 500_000
}

function scorePool(opportunity: PoolOpportunity, risk: RiskProfileId) {
  const liquidityWeight = risk === 'conservative' ? 1_400 : risk === 'balanced' ? 850 : 350
  return opportunity.feeAprBps + Math.log10(Math.max(opportunity.tvlUsd, 1)) * liquidityWeight
}

export function selectLiquidityOpportunity(snapshot: PancakeResearchSnapshot, risk: RiskProfileId) {
  return snapshot.liquidity.opportunities
    .filter((opportunity) => opportunityFitsRisk(opportunity, risk))
    .sort((a, b) => scorePool(b, risk) - scorePool(a, risk))[0] ?? null
}

export function selectFarmOpportunity(snapshot: PancakeResearchSnapshot, risk: RiskProfileId) {
  return snapshot.farms.opportunities
    .filter((opportunity) => opportunityFitsRisk(opportunity, risk))
    .sort((a, b) => {
      const riskAdjustedA = a.totalAprBps + Math.log10(Math.max(a.tvlUsd, 1)) * (risk === 'conservative' ? 1_400 : 500)
      const riskAdjustedB = b.totalAprBps + Math.log10(Math.max(b.tvlUsd, 1)) * (risk === 'conservative' ? 1_400 : 500)
      return riskAdjustedB - riskAdjustedA
    })[0] ?? null
}

export function selectEarnOpportunity(snapshot: PancakeResearchSnapshot) {
  return snapshot.earn.opportunities
    .filter((opportunity) => opportunity.stakeSymbol === 'CAKE' && opportunity.earnSymbol === 'USDT')
    .sort((a, b) => b.rewardAprBps - a.rewardAprBps)[0] ?? null
}

export async function fetchPancakeResearch(signal?: AbortSignal) {
  const response = await fetch(`${import.meta.env.BASE_URL}data/pancake-research.json?t=${Date.now()}`, {
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`PancakeSwap research snapshot returned ${response.status}.`)
  return pancakeResearchSchema.parse(await response.json())
}

export function protocolLabel(protocol: string) {
  if (protocol === 'v3') return 'V3'
  if (protocol === 'infinityCl') return 'Infinity CL'
  if (protocol === 'infinityBin') return 'Infinity Bin'
  if (protocol === 'stable') return 'StableSwap'
  return protocol
}
