import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import type { PortfolioPlan } from '../domain/portfolio'
import { stablecoinConfig } from '../lib/tokens'
import {
  buildPancakePermissions,
  hasExistingPancakeExposure,
  pendingPancakeModules,
  PANCAKE_CAKE_POOL,
  PANCAKE_CAKE_WBNB_LP,
  PANCAKE_MASTERCHEF_V2,
  PANCAKE_TESTNET_CAKE,
  PANCAKE_V2_ROUTER,
  type PancakeDeploymentPlan,
} from './pancakeExecutor'

const usdt = stablecoinConfig('USDT')

const deployment: PancakeDeploymentPlan = {
  stablecoin: 'USDT',
  stableBalance: parseEther('10'),
  reserveAmount: parseEther('2'),
  marketAmount: parseEther('3'),
  liquidityAmount: parseEther('3'),
  earnAmount: parseEther('2'),
  slippageBps: 100n,
  marketQuote: { amountIn: parseEther('3'), quotedOut: parseEther('0.006'), minimumOut: parseEther('0.00594'), router: usdt.router, path: [usdt.address, '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd'] },
  liquidityQuote: { amountIn: parseEther('3'), quotedOut: parseEther('0.006'), minimumOut: parseEther('0.00594'), router: usdt.router, path: [usdt.address, '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd'] },
  liquidityCakeQuote: { amountIn: parseEther('0.00297'), quotedOut: parseEther('2'), minimumOut: parseEther('1.98'), router: PANCAKE_V2_ROUTER, path: ['0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', PANCAKE_TESTNET_CAKE] },
  earnQuote: { amountIn: parseEther('2'), quotedOut: parseEther('0.004'), minimumOut: parseEther('0.00396'), router: usdt.router, path: [usdt.address, '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd'] },
  earnCakeQuote: { amountIn: parseEther('0.00396'), quotedOut: parseEther('2.5'), minimumOut: parseEther('2.475'), router: PANCAKE_V2_ROUTER, path: ['0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd', PANCAKE_TESTNET_CAKE] },
  liquidityNativeForCake: parseEther('0.00297'),
  liquidityNativeForPair: parseEther('0.00297'),
  lpCakeDesired: parseEther('1.98'),
  estimatedLp: parseEther('0.08'),
  stableAllowance: parseEther('8'),
  stableApprovalCap: parseEther('11.5'),
  cakeRouterAllowance: parseEther('2.1'),
  cakePoolAllowance: parseEther('2.625'),
  lpAllowance: parseEther('0.084'),
}

const rebalance = {
  dailyNativeCap: parseEther('0.002'),
  dailyStableCap: parseEther('3.5'),
} as PortfolioPlan

describe('PancakeSwap module permissions', () => {
  it('pins Swap, LP, Farm, and Earn calls to their official testnet contracts', () => {
    const permissions = buildPancakePermissions(deployment, rebalance)

    expect(permissions.calls).toEqual(expect.arrayContaining([
      { to: usdt.router, signature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)' },
      { to: PANCAKE_V2_ROUTER, signature: 'addLiquidityETH(address,uint256,uint256,uint256,address,uint256)' },
      { to: PANCAKE_MASTERCHEF_V2, signature: 'deposit(uint256,uint256)' },
      { to: PANCAKE_CAKE_POOL, signature: 'deposit(uint256,uint256)' },
    ]))
    expect(permissions.calls).toHaveLength(6)
  })

  it('never grants token approval authority to the AI session', () => {
    const permissions = buildPancakePermissions(deployment, rebalance)

    expect((permissions.calls ?? []).some((call) => 'signature' in call && call.signature.startsWith('approve('))).toBe(false)
    expect((permissions.calls ?? []).some((call) => 'signature' in call && (
      call.signature.startsWith('withdraw(') || call.signature.startsWith('removeLiquidity')
    ))).toBe(false)
    expect(permissions.spend).toContainEqual({
      limit: deployment.stableApprovalCap,
      period: 'day',
      token: usdt.address,
    })
  })

  it('caps CAKE and LP spending at the owner-approved deployment bounds', () => {
    const permissions = buildPancakePermissions(deployment, rebalance)

    expect(permissions.spend).toContainEqual({
      limit: deployment.cakeRouterAllowance + deployment.cakePoolAllowance,
      period: 'day',
      token: PANCAKE_TESTNET_CAKE,
    })
    expect(permissions.spend).toContainEqual({
      limit: deployment.lpAllowance,
      period: 'day',
      token: PANCAKE_CAKE_WBNB_LP,
    })
  })
})

describe('PancakeSwap activation recovery', () => {
  const emptyPositions = {
    stablecoin: 'USDT' as const,
    stableBalance: parseEther('10'),
    nativeBalance: parseEther('0.003'),
    cakeBalance: 0n,
    lpWalletBalance: 0n,
    farmStaked: 0n,
    earnShares: 0n,
    earnCakeValue: 0n,
    observedAt: '2026-08-23T00:00:00.000Z',
  }

  it('does not treat normalized reserve capital as an existing deployment', () => {
    expect(hasExistingPancakeExposure(emptyPositions)).toBe(false)
  })

  it('detects yield positions but not an already-created liquid market sleeve', () => {
    expect(hasExistingPancakeExposure({ ...emptyPositions, farmStaked: 1n })).toBe(true)
    expect(hasExistingPancakeExposure({ ...emptyPositions, earnShares: 1n })).toBe(true)
    expect(hasExistingPancakeExposure({ ...emptyPositions, nativeBalance: parseEther('0.0031') })).toBe(false)
  })

  it('resumes only the modules that are not already confirmed', () => {
    expect(pendingPancakeModules(new Set(['SWAP']))).toEqual(['LIQUIDITY', 'FARM', 'EARN'])
    expect(pendingPancakeModules(new Set(['SWAP', 'LIQUIDITY', 'FARM', 'EARN']))).toEqual([])
  })
})
