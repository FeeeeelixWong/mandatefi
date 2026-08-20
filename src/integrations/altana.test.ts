import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'
import { buildPortfolioPlan } from '../domain/portfolio'
import {
  ALTANA_CHAIN_ID,
  ALTANA_KEYSTORE,
  ALTANA_NATIVE_FEE_CAP,
  BSC_TESTNET_BUSD,
  PANCAKE_V2_ROUTER,
  SAFE_REBALANCE_NATIVE_CAP,
  altanaClient,
  buildPortfolioPermissions,
  buildSafeRebalancePermissions,
  buildVerificationPermissions,
  grantAndVerifyAltanaMandate,
  minimumOutputFor,
  type AltanaWalletProfile,
} from './altana'

afterEach(() => vi.restoreAllMocks())

describe('Altana verification mandate', () => {
  it('pins the session to the BSC Testnet KeyStore verification call', () => {
    const permissions = buildVerificationPermissions()

    expect(ALTANA_CHAIN_ID).toBe(97)
    expect(permissions.calls).toEqual([{
      to: ALTANA_KEYSTORE,
      signature: 'isValidKey(address,bytes32)',
    }])
    expect(permissions.spend).toEqual([{
      limit: ALTANA_NATIVE_FEE_CAP,
      period: 'day',
    }])
  })

  it('returns a live grant when immediate verification evidence fails', async () => {
    const address = '0x1111111111111111111111111111111111111111'
    const grant = {
      walletAddress: address,
      signer: {},
      publicKey: '0x1234',
      permissions: buildVerificationPermissions(),
      expiry: 1_800_000_000,
      transactionHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    } as unknown as Awaited<ReturnType<typeof altanaClient.grantSession>>
    const profile = {
      wallet: { address },
      signer: {},
      credential: { kind: 'webauthn', id: 'credential-id', publicKey: '0x1234' },
      createdAt: '2026-08-20T00:00:00.000Z',
    } as unknown as AltanaWalletProfile

    vi.spyOn(altanaClient, 'grantSession').mockResolvedValue(grant)
    vi.spyOn(altanaClient, 'execute').mockRejectedValue(new Error('relay unavailable'))

    const result = await grantAndVerifyAltanaMandate(profile, 7)

    expect(result.grant).toBe(grant)
    expect(result.verification).toBeUndefined()
    expect(result.verificationError).toBe('relay unavailable')
  })
})

describe('Safe Treasury Rebalance mandate', () => {
  it('pins the session to one PancakeSwap router method and native cap', () => {
    expect(buildSafeRebalancePermissions()).toEqual({
      calls: [{
        to: PANCAKE_V2_ROUTER,
        signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
      }],
      spend: [{
        limit: SAFE_REBALANCE_NATIVE_CAP,
        period: 'day',
      }],
    })
  })

  it('derives a deterministic 1% minimum output', () => {
    expect(minimumOutputFor(1_000_000n)).toBe(990_000n)
    expect(minimumOutputFor(445_735_144_932_801_459n)).toBe(441_277_793_483_473_444n)
  })
})

describe('Dynamic portfolio mandate', () => {
  const plan = buildPortfolioPlan({
    snapshot: {
      nativeBalance: parseEther('0.0115'),
      stableBalance: 0n,
      priceStablePerNative: parseEther('450'),
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    managedAmount: parseEther('0.01'),
    goal: 'balanced-growth',
    risk: 'balanced',
  })

  it('allows only the two PancakeSwap directions and the required BUSD approval', () => {
    expect(buildPortfolioPermissions(plan).calls).toEqual([
      {
        to: PANCAKE_V2_ROUTER,
        signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
      },
      {
        to: BSC_TESTNET_BUSD,
        signature: 'approve(address,uint256)',
      },
      {
        to: PANCAKE_V2_ROUTER,
        signature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
      },
    ])
  })

  it('derives native and token daily caps from the managed value', () => {
    expect(buildPortfolioPermissions(plan).spend).toEqual([
      { limit: parseEther('0.005'), period: 'day' },
      { limit: parseEther('2.25'), period: 'day', token: BSC_TESTNET_BUSD },
    ])
  })

  it('uses the selected risk profile when calculating minimum output', () => {
    expect(minimumOutputFor(1_000_000n, 50n)).toBe(995_000n)
    expect(minimumOutputFor(1_000_000n, 150n)).toBe(985_000n)
  })
})
