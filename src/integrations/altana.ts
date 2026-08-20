import {
  BNB_TESTNET,
  createClient,
  signerFromPasskey,
  type ExecuteResult,
  type GrantSessionResult,
  type PasskeyCredential,
  type PasskeySigner,
  type Wallet,
} from '@altananetwork/sdk'
import {
  encodeFunctionData,
  formatEther,
  getAddress,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { z } from 'zod'
import { bscTestnetClient } from '../lib/chains'

const STORAGE_KEY = 'mandatefi.altana-wallet.v1'

export const ALTANA_CHAIN_ID = BNB_TESTNET.chainId
export const ALTANA_FUNDING_AMOUNT = parseEther('0.01')
export const ALTANA_MINIMUM_BALANCE = parseEther('0.003')
export const ALTANA_NATIVE_FEE_CAP = parseEther('0.003')
export const ALTANA_KEYSTORE = BNB_TESTNET.keyStore

const passkeyCredentialSchema = z.object({
  kind: z.literal('webauthn'),
  id: z.string().min(1),
  publicKey: z.string().regex(/^0x[0-9a-fA-F]+$/),
  rpId: z.string().min(1).optional(),
})

const storedWalletSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  credential: passkeyCredentialSchema,
  createdAt: z.string(),
})

const keyStoreReadAbi = [{
  name: 'isValidKey',
  type: 'function',
  stateMutability: 'view',
  inputs: [
    { name: 'user', type: 'address' },
    { name: 'keyId', type: 'bytes32' },
  ],
  outputs: [{ type: 'bool' }],
}] as const

export type AltanaWalletProfile = {
  wallet: Wallet
  signer: PasskeySigner
  credential: Extract<PasskeyCredential, { kind: 'webauthn' }>
  createdAt: string
}

export type AltanaMandateProof = {
  session: GrantSessionResult
  grant: GrantSessionResult
  verification?: ExecuteResult
  verificationError?: string
}

export const altanaClient = createClient({
  chains: [BNB_TESTNET],
  defaultChainId: BNB_TESTNET.chainId,
})

function toProfile(
  address: Address,
  credential: Extract<PasskeyCredential, { kind: 'webauthn' }>,
  createdAt: string,
): AltanaWalletProfile {
  return {
    wallet: { address },
    signer: signerFromPasskey(credential),
    credential,
    createdAt,
  }
}

function persistProfile(profile: AltanaWalletProfile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    address: profile.wallet.address,
    credential: profile.credential,
    createdAt: profile.createdAt,
  }))
}

export function loadAltanaWallet(): AltanaWalletProfile | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const stored = storedWalletSchema.parse(JSON.parse(raw))
    const credential = stored.credential as Extract<PasskeyCredential, { kind: 'webauthn' }>
    return toProfile(getAddress(stored.address), credential, stored.createdAt)
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

export async function createAltanaWallet(): Promise<AltanaWalletProfile> {
  const result = await altanaClient.createPasskeyWallet({ name: 'MandateFi Owner' })
  if (result.signer.credential.kind !== 'webauthn') {
    throw new Error('A device-backed passkey is required in the browser.')
  }
  const profile: AltanaWalletProfile = {
    wallet: { address: result.address },
    signer: result.signer,
    credential: result.signer.credential,
    createdAt: new Date().toISOString(),
  }
  persistProfile(profile)
  return profile
}

export async function recoverAltanaWallet(): Promise<AltanaWalletProfile> {
  const result = await altanaClient.recoverFromPasskey({ chainId: ALTANA_CHAIN_ID })
  if (result.signer.credential.kind !== 'webauthn') {
    throw new Error('A device-backed passkey is required in the browser.')
  }
  const profile: AltanaWalletProfile = {
    wallet: { address: result.address },
    signer: result.signer,
    credential: result.signer.credential,
    createdAt: new Date().toISOString(),
  }
  persistProfile(profile)
  return profile
}

export async function readAltanaBalance(address: Address) {
  return bscTestnetClient.getBalance({ address })
}

export function formatAltanaBalance(value: bigint | null) {
  if (value === null) return '—'
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

export function buildVerificationPermissions() {
  return {
    calls: [{
      to: ALTANA_KEYSTORE,
      signature: 'isValidKey(address,bytes32)',
    }],
    spend: [{
      limit: ALTANA_NATIVE_FEE_CAP,
      period: 'day',
    }],
  } as const
}

export async function grantAndVerifyAltanaMandate(
  profile: AltanaWalletProfile,
  durationDays: number,
  onStage?: (stage: 'granting' | 'executing') => void,
): Promise<AltanaMandateProof> {
  const expiry = Math.floor(Date.now() / 1000) + durationDays * 24 * 60 * 60
  onStage?.('granting')
  const grant = await altanaClient.grantSession({
    wallet: profile.wallet,
    signer: profile.signer,
    chainId: ALTANA_CHAIN_ID,
    permissions: buildVerificationPermissions(),
    expiry,
    register: true,
  })

  onStage?.('executing')
  const keyId = keccak256(grant.publicKey)
  const data = encodeFunctionData({
    abi: keyStoreReadAbi,
    functionName: 'isValidKey',
    args: [profile.wallet.address, keyId],
  })
  try {
    const verification = await altanaClient.execute({
      session: grant,
      chainId: ALTANA_CHAIN_ID,
      calls: [{ to: ALTANA_KEYSTORE, value: 0n, data }],
    })
    return {
      session: grant,
      grant,
      verification,
      verificationError: verification.status === 'FAILED'
        ? 'The session was granted, but its verification call failed.'
        : undefined,
    }
  } catch (error) {
    // The grant is already live. Return it so the UI can persist and revoke it.
    return {
      session: grant,
      grant,
      verificationError: altanaErrorMessage(error),
    }
  }
}

export async function revokeAltanaMandate(
  profile: AltanaWalletProfile,
  sessionPublicKey: Hex,
) {
  return altanaClient.revokeSession({
    wallet: profile.wallet,
    signer: profile.signer,
    session: sessionPublicKey,
    chainId: ALTANA_CHAIN_ID,
  })
}

export function altanaExplorerTx(hash?: Hex) {
  return hash ? `${BNB_TESTNET.explorer}/tx/${hash}` : null
}

export function altanaErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'The passkey request was cancelled or timed out.'
  }
  if (error instanceof Error) return error.message
  return 'The Altana operation could not be completed.'
}
