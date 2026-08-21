import { describe, expect, it } from 'vitest'
import {
  pancakeResearchSchema,
  selectFarmOpportunity,
  selectLiquidityOpportunity,
} from './pancakeResearch'

const basePool = {
  id: '0x1111111111111111111111111111111111111111',
  protocol: 'v3',
  token0Address: '0x1111111111111111111111111111111111111111',
  token1Address: '0x2222222222222222222222222222222222222222',
  feeTierBps: 1,
  volumeUsd24h: 1_000_000,
  link: 'https://pancakeswap.finance/liquidity/pools',
}

const snapshot = pancakeResearchSchema.parse({
  schemaVersion: 1,
  generatedAt: '2026-08-21T10:00:00.000Z',
  network: { name: 'BNB Chain mainnet', chainId: 56 },
  methodology: { tokenUniverse: ['USDT', 'USDC', 'WBNB'], minimumTvlUsd: 250_000, note: 'Test fixture' },
  liquidity: {
    observedAt: '2026-08-21T10:00:00.000Z',
    opportunities: [
      { ...basePool, pair: 'USDT/USDC', tvlUsd: 30_000_000, feeAprBps: 120 },
      { ...basePool, id: '0x2222222222222222222222222222222222222222', pair: 'USDT/WBNB', tvlUsd: 12_000_000, feeAprBps: 4_000 },
    ],
  },
  farms: {
    observedAt: '2026-08-21T10:00:00.000Z',
    opportunities: [
      { ...basePool, pair: 'USDT/USDC', tvlUsd: 30_000_000, feeAprBps: 120, pid: 1, rewardAprBps: 20, totalAprBps: 140, rewardToken: 'CAKE' },
      { ...basePool, id: '0x2222222222222222222222222222222222222222', pair: 'USDT/WBNB', tvlUsd: 12_000_000, feeAprBps: 4_000, pid: 2, rewardAprBps: 300, totalAprBps: 4_300, rewardToken: 'CAKE' },
    ],
  },
  earn: { observedAt: '2026-08-21T10:00:00.000Z', opportunities: [] },
  sources: [{ label: 'PancakeSwap', url: 'https://pancakeswap.finance' }],
})

describe('PancakeSwap research selection', () => {
  it('keeps conservative liquidity inside stablecoin pools', () => {
    expect(selectLiquidityOpportunity(snapshot, 'conservative')?.pair).toBe('USDT/USDC')
  })

  it('lets a balanced mandate prefer a deeper risk-adjusted blue-chip farm', () => {
    expect(selectFarmOpportunity(snapshot, 'balanced')?.pair).toBe('USDT/WBNB')
  })
})
