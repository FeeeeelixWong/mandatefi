import { describe, expect, it } from 'vitest'
import { pancakeMarketSnapshotSchema } from '../integrations/pancakeMarket'
import { pancakeResearchSchema } from '../integrations/pancakeResearch'
import {
  buildStablecoinSelectionRequest,
  deterministicStablecoinSelection,
} from './stablecoinAllocator'

const market = pancakeMarketSnapshotSchema.parse({
  provider: 'PancakeSwap Price API SDK',
  sdkVersion: 'test',
  chainId: 56,
  observedAt: '2026-08-22T00:00:00.000Z',
  pricesUsd: { bnb: 600, cake: 3, usdt: 1, usdc: 0.9998 },
  stablecoinMaxDeviationBps: 2,
  sourceUrl: 'https://developer.pancakeswap.finance/sdks/price-api-sdk',
})

const research = pancakeResearchSchema.parse({
  schemaVersion: 1,
  generatedAt: '2026-08-22T00:00:00.000Z',
  network: { name: 'BNB Chain mainnet', chainId: 56 },
  methodology: { tokenUniverse: ['USDT', 'USDC', 'WBNB'], minimumTvlUsd: 250_000, note: 'Test data' },
  liquidity: {
    observedAt: '2026-08-22T00:00:00.000Z',
    opportunities: [
      { id: 'usdt-pool', pair: 'USDT/WBNB', protocol: 'v3', token0Address: '0x1111111111111111111111111111111111111111', token1Address: '0x2222222222222222222222222222222222222222', feeTierBps: 1, tvlUsd: 12_000_000, volumeUsd24h: 20_000_000, feeAprBps: 3_500, link: 'https://pancakeswap.finance/' },
      { id: 'usdc-pool', pair: 'USDC/WBNB', protocol: 'v3', token0Address: '0x3333333333333333333333333333333333333333', token1Address: '0x2222222222222222222222222222222222222222', feeTierBps: 1, tvlUsd: 3_000_000, volumeUsd24h: 10_000_000, feeAprBps: 5_800, link: 'https://pancakeswap.finance/' },
      { id: 'stable-pool', pair: 'USDT/USDC', protocol: 'v3', token0Address: '0x1111111111111111111111111111111111111111', token1Address: '0x3333333333333333333333333333333333333333', feeTierBps: 1, tvlUsd: 30_000_000, volumeUsd24h: 15_000_000, feeAprBps: 120, link: 'https://pancakeswap.finance/' },
    ],
  },
  farms: {
    observedAt: '2026-08-22T00:00:00.000Z',
    opportunities: [
      { id: 'usdt-farm', pair: 'USDT/WBNB', protocol: 'v3', token0Address: '0x1111111111111111111111111111111111111111', token1Address: '0x2222222222222222222222222222222222222222', feeTierBps: 1, tvlUsd: 12_000_000, volumeUsd24h: 20_000_000, feeAprBps: 3_500, link: 'https://pancakeswap.finance/', pid: 1, rewardAprBps: 300, totalAprBps: 3_800, rewardToken: 'CAKE' },
      { id: 'usdc-farm', pair: 'USDC/WBNB', protocol: 'v3', token0Address: '0x3333333333333333333333333333333333333333', token1Address: '0x2222222222222222222222222222222222222222', feeTierBps: 1, tvlUsd: 3_000_000, volumeUsd24h: 10_000_000, feeAprBps: 5_800, link: 'https://pancakeswap.finance/', pid: 2, rewardAprBps: 200, totalAprBps: 6_000, rewardToken: 'CAKE' },
    ],
  },
  earn: { observedAt: '2026-08-22T00:00:00.000Z', opportunities: [] },
  sources: [{ label: 'PancakeSwap', url: 'https://pancakeswap.finance/' }],
})

describe('stablecoin allocator', () => {
  it('selects the stronger risk-adjusted candidate for a balanced mandate', () => {
    const input = buildStablecoinSelectionRequest({
      goal: 'balanced-growth',
      riskProfile: 'balanced',
      liquidityNeed: 'weekly',
      horizonDays: 30,
      market,
      research,
      quoteRates: { USDT: 600, USDC: 600 },
    })

    const result = deterministicStablecoinSelection(input)
    expect(result.stablecoin).toBe('USDC')
    expect(result.rationale).toContain('risk-adjusted')
    expect(input.candidates).toHaveLength(2)
  })

  it('limits a conservative mandate to stable-stable opportunities', () => {
    const input = buildStablecoinSelectionRequest({
      goal: 'preserve',
      riskProfile: 'conservative',
      liquidityNeed: 'anytime',
      horizonDays: 7,
      market,
      research,
    })

    expect(input.candidates.every((candidate) => candidate.bestOpportunityPair === 'USDT/USDC')).toBe(true)
  })
})
