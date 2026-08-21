import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPancakeMarket, pancakeMarketSnapshotSchema } from './pancakeMarket'

const validSnapshot = {
  provider: 'PancakeSwap Price API SDK' as const,
  sdkVersion: '11.1.1',
  chainId: 56 as const,
  observedAt: '2026-08-21T12:00:00.000Z',
  pricesUsd: { bnb: 680, cake: 1.74, usdt: 0.9998, usdc: 1.0001 },
  stablecoinMaxDeviationBps: 2,
  sourceUrl: 'https://developer.pancakeswap.finance/sdks/price-api-sdk' as const,
}

afterEach(() => vi.restoreAllMocks())

describe('PancakeSwap market snapshot', () => {
  it('accepts a complete positive-price snapshot', () => {
    expect(pancakeMarketSnapshotSchema.parse(validSnapshot)).toEqual(validSnapshot)
  })

  it('rejects a missing price represented as zero', () => {
    expect(() => pancakeMarketSnapshotSchema.parse({
      ...validSnapshot,
      pricesUsd: { ...validSnapshot.pricesUsd, cake: 0 },
    })).toThrow()
  })

  it('loads and validates the Vercel market endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(validSnapshot), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    await expect(fetchPancakeMarket('/api/market/prices')).resolves.toEqual(validSnapshot)
  })
})
