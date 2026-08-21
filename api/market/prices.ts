import { ChainId } from '@pancakeswap/chains'
import { getNativeTokenPrices, getTokenPrices } from '@pancakeswap/price-api-sdk'
import { bscTokens } from '@pancakeswap/tokens'
import {
  PANCAKE_PRICE_API_DOCUMENTATION,
  pancakeMarketSnapshotSchema,
  type PancakeMarketSnapshot,
} from '../../src/integrations/pancakeMarket.js'
import { configureRequest, type ApiRequest, type ApiResponse } from '../_lib/http.js'

const CACHE_TTL_MS = 30_000
const REQUEST_TIMEOUT_MS = 8_000
const SDK_VERSION = '11.1.1'

let cachedSnapshot: PancakeMarketSnapshot | null = null
let cachedAt = 0

function requirePrice(value: number | undefined, symbol: string) {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    throw new Error(`PancakeSwap did not return a valid ${symbol} price.`)
  }
  return value as number
}

function tokenPrice(
  prices: Awaited<ReturnType<typeof getTokenPrices>>,
  address: string,
  symbol: string,
) {
  const result = prices.find((price) => price.address.toLowerCase() === address.toLowerCase())
  return requirePrice(result?.priceUSD, symbol)
}

async function readOfficialPrices(): Promise<PancakeMarketSnapshot> {
  const options = { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  const addresses = [bscTokens.cake.address, bscTokens.usdt.address, bscTokens.usdc.address]
  const [nativePrices, tokenPrices] = await Promise.all([
    getNativeTokenPrices([ChainId.BSC], options),
    getTokenPrices(ChainId.BSC, addresses, options),
  ])
  const bnb = requirePrice(nativePrices.get(ChainId.BSC), 'BNB')
  const cake = tokenPrice(tokenPrices, bscTokens.cake.address, 'CAKE')
  const usdt = tokenPrice(tokenPrices, bscTokens.usdt.address, 'USDT')
  const usdc = tokenPrice(tokenPrices, bscTokens.usdc.address, 'USDC')
  const stablecoinMaxDeviationBps = Math.round(Math.max(Math.abs(usdt - 1), Math.abs(usdc - 1)) * 10_000)

  return pancakeMarketSnapshotSchema.parse({
    provider: 'PancakeSwap Price API SDK',
    sdkVersion: SDK_VERSION,
    chainId: ChainId.BSC,
    observedAt: new Date().toISOString(),
    pricesUsd: { bnb, cake, usdt, usdc },
    stablecoinMaxDeviationBps,
    sourceUrl: PANCAKE_PRICE_API_DOCUMENTATION,
  })
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!configureRequest(request, response)) return
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  response.setHeader('Cache-Control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=120')
  if (cachedSnapshot && Date.now() - cachedAt < CACHE_TTL_MS) {
    response.status(200).json(cachedSnapshot)
    return
  }

  try {
    cachedSnapshot = await readOfficialPrices()
    cachedAt = Date.now()
    response.status(200).json(cachedSnapshot)
  } catch (error) {
    console.error('PancakeSwap Price API request failed.', error)
    if (cachedSnapshot) {
      response.setHeader('X-MandateFi-Stale-Price', '1')
      response.status(200).json(cachedSnapshot)
      return
    }
    response.status(502).json({ error: 'PancakeSwap market prices are temporarily unavailable.' })
  }
}
