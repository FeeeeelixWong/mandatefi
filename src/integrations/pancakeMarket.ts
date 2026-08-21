import { z } from 'zod'

export const PANCAKE_PRICE_API_DOCUMENTATION = 'https://developer.pancakeswap.finance/sdks/price-api-sdk'

export const pancakeMarketSnapshotSchema = z.object({
  provider: z.literal('PancakeSwap Price API SDK'),
  sdkVersion: z.string().min(1),
  chainId: z.literal(56),
  observedAt: z.iso.datetime(),
  pricesUsd: z.object({
    bnb: z.number().positive(),
    cake: z.number().positive(),
    usdt: z.number().positive(),
    usdc: z.number().positive(),
  }).strict(),
  stablecoinMaxDeviationBps: z.number().int().nonnegative(),
  sourceUrl: z.literal(PANCAKE_PRICE_API_DOCUMENTATION),
}).strict()

export type PancakeMarketSnapshot = z.infer<typeof pancakeMarketSnapshotSchema>

export async function fetchPancakeMarket(
  endpoint = '/api/market/prices',
): Promise<PancakeMarketSnapshot> {
  const response = await fetch(endpoint, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`PancakeSwap market API returned ${response.status}.`)
  return pancakeMarketSnapshotSchema.parse(await response.json())
}
