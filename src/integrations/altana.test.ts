import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseEther } from 'viem'
import { buildPortfolioPlan } from '../domain/portfolio'
import { stablecoinConfig } from '../lib/tokens'
import { bscTestnetClient } from '../lib/chains'
import {
  ALTANA_CHAIN_ID,
  ALTANA_KEYSTORE,
  ALTANA_NATIVE_FEE_CAP,
  altanaClient,
  buildPortfolioPermissions,
  buildVerificationPermissions,
  grantAndVerifyAltanaMandate,
  minimumOutputFor,
  normalizeAltanaFunding,
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

describe('Portfolio quote safeguards', () => {
  it('derives a deterministic 1% minimum output', () => {
    expect(minimumOutputFor(1_000_000n)).toBe(990_000n)
    expect(minimumOutputFor(445_735_144_932_801_459n)).toBe(441_277_793_483_473_444n)
  })
})

describe('Owner funding normalization', () => {
  it('converts tBNB before the scoped AI session is created', async () => {
    const address = '0x1111111111111111111111111111111111111111'
    const amountIn = parseEther('0.007')
    const quotedOut = parseEther('3.5')
    const profile = {
      wallet: { address }, signer: {},
      credential: { kind: 'webauthn', id: 'credential-id', publicKey: '0x1234' },
      createdAt: '2026-08-20T00:00:00.000Z',
    } as unknown as AltanaWalletProfile
    vi.spyOn(bscTestnetClient, 'readContract')
      .mockResolvedValueOnce([amountIn, quotedOut] as never)
      .mockResolvedValueOnce(0n as never)
      .mockResolvedValueOnce(quotedOut as never)
    const transaction = {
      status: 'CONFIRMED',
      callsId: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      transactionHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    } as Awaited<ReturnType<typeof altanaClient.execute>>
    const execute = vi.spyOn(altanaClient, 'execute').mockResolvedValue(transaction)

    const result = await normalizeAltanaFunding(profile, 'USDT', amountIn)

    expect(result.outputReceived).toBe(quotedOut)
    expect(result.quote.minimumOut).toBe(parseEther('3.465'))
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      wallet: profile.wallet,
      signer: profile.signer,
      chainId: 97,
      calls: [{ to: stablecoinConfig('USDT').router, value: amountIn }],
    })
  })
})

describe('Dynamic portfolio mandate', () => {
  const plan = buildPortfolioPlan({
    snapshot: {
      nativeBalance: parseEther('0.0115'),
      stableBalance: 0n,
      stablecoin: 'USDT',
      priceStablePerNative: parseEther('450'),
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    managedAmount: parseEther('10'),
    goal: 'balanced-growth',
    risk: 'balanced',
  })

  it('allows only the selected PancakeSwap directions and USDT approval', () => {
    const usdt = stablecoinConfig('USDT')
    expect(buildPortfolioPermissions(plan).calls).toEqual([
      {
        to: usdt.router,
        signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
      },
      {
        to: usdt.address,
        signature: 'approve(address,uint256)',
      },
      {
        to: usdt.router,
        signature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
      },
    ])
  })

  it('derives native and token daily caps from the managed value', () => {
    const usdt = stablecoinConfig('USDT')
    expect(buildPortfolioPermissions(plan).spend).toEqual([
      { limit: parseEther('0.00425'), period: 'day' },
      { limit: parseEther('1.9125'), period: 'day', token: usdt.address },
    ])
  })

  it('uses the selected risk profile when calculating minimum output', () => {
    expect(minimumOutputFor(1_000_000n, 50n)).toBe(995_000n)
    expect(minimumOutputFor(1_000_000n, 150n)).toBe(985_000n)
  })
})
