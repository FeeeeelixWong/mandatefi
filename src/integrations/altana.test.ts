import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALTANA_CHAIN_ID,
  ALTANA_KEYSTORE,
  ALTANA_NATIVE_FEE_CAP,
  altanaClient,
  buildVerificationPermissions,
  grantAndVerifyAltanaMandate,
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
