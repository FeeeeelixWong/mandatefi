import {
  BNB_TESTNET,
  createClient,
  signerFromPasskey,
  type ExecuteResult,
  type GrantSessionResult,
  type PasskeyCredential,
  type PasskeySigner,
  type Session,
  type Wallet,
} from '@altananetwork/sdk'
import {
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  keccak256,
  parseEther,
  type Address,
  type Hex,
} from 'viem'
import { z } from 'zod'
import type { ExecutionCostEstimate } from '../domain/investmentCommittee'
import type { PortfolioPlan, PortfolioSnapshot } from '../domain/portfolio'
import { bscTestnetClient } from '../lib/chains'

const STORAGE_KEY = 'mandatefi.altana-wallet.v1'

export const ALTANA_CHAIN_ID = BNB_TESTNET.chainId
export const ALTANA_FUNDING_AMOUNT = parseEther('0.01')
export const ALTANA_MINIMUM_BALANCE = parseEther('0.003')
export const ALTANA_NATIVE_FEE_CAP = parseEther('0.003')
export const ALTANA_KEYSTORE = BNB_TESTNET.keyStore
export const PANCAKE_V2_ROUTER = getAddress('0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3')
export const BSC_TESTNET_WBNB = getAddress('0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd')
export const BSC_TESTNET_BUSD = getAddress('0x78867BbEeF44f2326bF8DDd1941a4439382EF2A7')
export const SAFE_REBALANCE_AMOUNT = parseEther('0.001')
export const SAFE_REBALANCE_NATIVE_CAP = parseEther('0.004')
export const SAFE_REBALANCE_SLIPPAGE_BPS = 100n
export const SAFE_REBALANCE_DEADLINE_SECONDS = 10 * 60

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

const pancakeRouterAbi = [
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETH',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const

const erc20BalanceAbi = [{
  name: 'balanceOf',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const

const erc20ApproveAbi = [{
  name: 'approve',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
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

export type SafeRebalanceQuote = {
  amountIn: bigint
  quotedOut: bigint
  minimumOut: bigint
  slippageBps: bigint
  outputSymbol: 'BUSD'
}

export type PortfolioRebalanceQuote = {
  amountIn: bigint
  quotedOut: bigint
  minimumOut: bigint
  slippageBps: bigint
  inputSymbol: 'tBNB' | 'BUSD'
  outputSymbol: 'tBNB' | 'BUSD'
}

export type AltanaStrategyProof = {
  session: GrantSessionResult
  grant: GrantSessionResult
  quote: SafeRebalanceQuote
  execution?: ExecuteResult
  executionError?: string
  outputReceived?: bigint
}

export type AltanaPortfolioProof = {
  session: GrantSessionResult
  grant: GrantSessionResult
  plan: PortfolioPlan
  quote?: PortfolioRebalanceQuote
  execution?: ExecuteResult
  executionError?: string
  outputReceived?: bigint
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

export function minimumOutputFor(quotedOut: bigint, slippageBps = SAFE_REBALANCE_SLIPPAGE_BPS) {
  return quotedOut * (10_000n - slippageBps) / 10_000n
}

export function buildSafeRebalancePermissions() {
  return {
    calls: [{
      to: PANCAKE_V2_ROUTER,
      signature: 'swapExactETHForTokens(uint256,address[],address,uint256)',
    }],
    spend: [{
      limit: SAFE_REBALANCE_NATIVE_CAP,
      period: 'day',
    }],
  } as const
}

export function buildPortfolioPermissions(plan: PortfolioPlan) {
  return {
    calls: [
      { to: PANCAKE_V2_ROUTER, signature: 'swapExactETHForTokens(uint256,address[],address,uint256)' },
      { to: BSC_TESTNET_BUSD, signature: 'approve(address,uint256)' },
      { to: PANCAKE_V2_ROUTER, signature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)' },
    ],
    spend: [
      { limit: plan.dailyNativeCap, period: 'day' },
      { limit: plan.dailyStableCap, period: 'day', token: BSC_TESTNET_BUSD },
    ],
  } as const
}

export async function quoteSafeRebalance(): Promise<SafeRebalanceQuote> {
  const amounts = await bscTestnetClient.readContract({
    address: PANCAKE_V2_ROUTER,
    abi: pancakeRouterAbi,
    functionName: 'getAmountsOut',
    args: [SAFE_REBALANCE_AMOUNT, [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD]],
  })
  const quotedOut = amounts.at(-1)
  if (!quotedOut || quotedOut <= 0n) throw new Error('PancakeSwap returned no executable BUSD quote.')
  return {
    amountIn: SAFE_REBALANCE_AMOUNT,
    quotedOut,
    minimumOut: minimumOutputFor(quotedOut),
    slippageBps: SAFE_REBALANCE_SLIPPAGE_BPS,
    outputSymbol: 'BUSD',
  }
}

export async function quotePortfolioPlan(plan: PortfolioPlan): Promise<PortfolioRebalanceQuote | null> {
  if (plan.action === 'HOLD' || plan.amountIn <= 0n) return null
  const path = plan.action === 'BUY_STABLE'
    ? [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD]
    : [BSC_TESTNET_BUSD, BSC_TESTNET_WBNB]
  const amounts = await bscTestnetClient.readContract({
    address: PANCAKE_V2_ROUTER,
    abi: pancakeRouterAbi,
    functionName: 'getAmountsOut',
    args: [plan.amountIn, path],
  })
  const quotedOut = amounts.at(-1)
  if (!quotedOut || quotedOut <= 0n) throw new Error('PancakeSwap returned no executable quote for this allocation change.')
  return {
    amountIn: plan.amountIn,
    quotedOut,
    minimumOut: minimumOutputFor(quotedOut, plan.maxSlippageBps),
    slippageBps: plan.maxSlippageBps,
    inputSymbol: plan.inputAsset,
    outputSymbol: plan.outputAsset,
  }
}

export async function estimatePortfolioExecutionCost(
  plan: PortfolioPlan,
  quote: PortfolioRebalanceQuote | null,
): Promise<ExecutionCostEstimate> {
  const observedAt = new Date().toISOString()
  if (plan.action === 'HOLD' || !quote) {
    return {
      observedAt,
      gasPriceGwei: 0,
      gasUnits: 0,
      gasCostNative: '0',
      gasCostBps: 0,
      slippageReserveBps: 0,
      priceImpactBps: 0,
      exitCostBps: 0,
      totalCostBps: 0,
      source: 'NO_ACTION',
      note: 'No transaction is proposed.',
    }
  }

  const path = plan.action === 'BUY_STABLE'
    ? [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD]
    : [BSC_TESTNET_BUSD, BSC_TESTNET_WBNB]
  const marginalInput = plan.action === 'BUY_STABLE' ? parseEther('0.0001') : parseEther('0.05')
  const probeInput = plan.amountIn < marginalInput ? plan.amountIn : marginalInput
  const [gasPrice, marginalAmounts] = await Promise.all([
    bscTestnetClient.getGasPrice(),
    bscTestnetClient.readContract({
      address: PANCAKE_V2_ROUTER,
      abi: pancakeRouterAbi,
      functionName: 'getAmountsOut',
      args: [probeInput, path],
    }),
  ])
  const marginalOut = marginalAmounts.at(-1) ?? 0n
  const linearOut = probeInput > 0n ? marginalOut * plan.amountIn / probeInput : quote.quotedOut
  const priceImpactBps = linearOut > quote.quotedOut && linearOut > 0n
    ? Number((linearOut - quote.quotedOut) * 10_000n / linearOut)
    : 0
  // A conservative smart-wallet envelope: approve + swap requires the larger allowance.
  const gasUnits = plan.action === 'BUY_STABLE' ? 260_000 : 340_000
  const gasCost = gasPrice * BigInt(gasUnits)
  const gasCostBps = plan.managedValue > 0n
    ? Number(gasCost * 10_000n / plan.managedValue)
    : 10_000
  const slippageReserveBps = Number(plan.maxSlippageBps)
  const exitCostBps = 0
  const totalCostBps = gasCostBps + slippageReserveBps + priceImpactBps + exitCostBps

  return {
    observedAt,
    gasPriceGwei: Number(gasPrice) / 1e9,
    gasUnits,
    gasCostNative: formatEther(gasCost),
    gasCostBps,
    slippageReserveBps,
    priceImpactBps,
    exitCostBps,
    totalCostBps,
    source: 'BSC_RPC_AND_PANCAKESWAP_QUOTE',
    note: 'PancakeSwap pool fees are embedded in the quoted output; the model does not double-count them.',
  }
}

export function formatStrategyToken(value: bigint) {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })
}

export async function readBusdBalance(address: Address) {
  return bscTestnetClient.readContract({
    address: BSC_TESTNET_BUSD,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: [address],
  })
}

export async function readPortfolioSnapshot(address: Address): Promise<PortfolioSnapshot> {
  const [nativeBalance, stableBalance, unitQuote] = await Promise.all([
    readAltanaBalance(address),
    readBusdBalance(address),
    bscTestnetClient.readContract({
      address: PANCAKE_V2_ROUTER,
      abi: pancakeRouterAbi,
      functionName: 'getAmountsOut',
      args: [parseEther('1'), [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD]],
    }),
  ])
  const priceStablePerNative = unitQuote.at(-1)
  if (!priceStablePerNative || priceStablePerNative <= 0n) {
    throw new Error('PancakeSwap price feed is unavailable.')
  }
  return {
    nativeBalance,
    stableBalance,
    priceStablePerNative,
    updatedAt: new Date().toISOString(),
  }
}

export async function readPancakePrice() {
  const amounts = await bscTestnetClient.readContract({
    address: PANCAKE_V2_ROUTER,
    abi: pancakeRouterAbi,
    functionName: 'getAmountsOut',
    args: [parseEther('1'), [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD]],
  })
  const price = amounts.at(-1)
  if (!price || price <= 0n) throw new Error('PancakeSwap price feed is unavailable.')
  return price
}

async function waitForBusdIncrease(address: Address, before: bigint) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readBusdBalance(address)
    if (current > before) return current - before
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  return 0n
}

async function waitForNativeIncrease(address: Address, before: bigint) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const current = await readAltanaBalance(address)
    if (current > before) return current - before
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  return 0n
}

export async function grantAndExecutePortfolioPlan(
  profile: AltanaWalletProfile,
  durationDays: number,
  plan: PortfolioPlan,
  onStage?: (stage: 'granting' | 'executing') => void,
  executeApprovedPlan = true,
): Promise<AltanaPortfolioProof> {
  const expiry = Math.floor(Date.now() / 1000) + durationDays * 24 * 60 * 60
  const quote = executeApprovedPlan ? await quotePortfolioPlan(plan) : null

  onStage?.('granting')
  const grant = await altanaClient.grantSession({
    wallet: profile.wallet,
    signer: profile.signer,
    chainId: ALTANA_CHAIN_ID,
    permissions: buildPortfolioPermissions(plan),
    expiry,
    register: true,
  })

  if (!executeApprovedPlan || !quote || plan.action === 'HOLD') {
    return { session: grant, grant, plan }
  }

  const executed = await executePortfolioPlanWithSession(grant, plan, quote, onStage)
  return { session: grant, grant, plan, ...executed }
}

export async function executePortfolioPlanWithSession(
  session: Session,
  plan: PortfolioPlan,
  suppliedQuote?: PortfolioRebalanceQuote,
  onStage?: (stage: 'granting' | 'executing') => void,
): Promise<Pick<AltanaPortfolioProof, 'quote' | 'execution' | 'executionError' | 'outputReceived'>> {
  const quote = suppliedQuote ?? await quotePortfolioPlan(plan)
  if (!quote || plan.action === 'HOLD') return {}

  const deadline = BigInt(Math.floor(Date.now() / 1000) + SAFE_REBALANCE_DEADLINE_SECONDS)
  const calls = plan.action === 'BUY_STABLE'
    ? [{
      to: PANCAKE_V2_ROUTER,
      value: plan.amountIn,
      data: encodeFunctionData({
        abi: pancakeRouterAbi,
        functionName: 'swapExactETHForTokens',
        args: [quote.minimumOut, [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD], session.walletAddress, deadline],
      }),
    }]
    : [
      {
        to: BSC_TESTNET_BUSD,
        value: 0n,
        data: encodeFunctionData({
          abi: erc20ApproveAbi,
          functionName: 'approve',
          args: [PANCAKE_V2_ROUTER, plan.amountIn],
        }),
      },
      {
        to: PANCAKE_V2_ROUTER,
        value: 0n,
        data: encodeFunctionData({
          abi: pancakeRouterAbi,
          functionName: 'swapExactTokensForETH',
          args: [plan.amountIn, quote.minimumOut, [BSC_TESTNET_BUSD, BSC_TESTNET_WBNB], session.walletAddress, deadline],
        }),
      },
    ]

  const outputBefore = plan.action === 'BUY_STABLE'
    ? await readBusdBalance(session.walletAddress)
    : await readAltanaBalance(session.walletAddress)

  onStage?.('executing')
  try {
    const execution = await altanaClient.execute({
      session,
      chainId: ALTANA_CHAIN_ID,
      calls,
    })
    const outputReceived = execution.status === 'CONFIRMED'
      ? plan.action === 'BUY_STABLE'
        ? await waitForBusdIncrease(session.walletAddress, outputBefore)
        : await waitForNativeIncrease(session.walletAddress, outputBefore)
      : 0n
    return {
      quote,
      execution,
      outputReceived,
      executionError: execution.status === 'FAILED'
        ? 'The bounded PancakeSwap rebalance failed; the policy remains revocable.'
        : undefined,
    }
  } catch (error) {
    return {
      quote,
      executionError: altanaErrorMessage(error),
    }
  }
}

export async function grantAndExecuteSafeRebalance(
  profile: AltanaWalletProfile,
  durationDays: number,
  onStage?: (stage: 'granting' | 'executing') => void,
): Promise<AltanaStrategyProof> {
  const expiry = Math.floor(Date.now() / 1000) + durationDays * 24 * 60 * 60
  const quote = await quoteSafeRebalance()
  const balanceBefore = await readBusdBalance(profile.wallet.address)

  onStage?.('granting')
  const grant = await altanaClient.grantSession({
    wallet: profile.wallet,
    signer: profile.signer,
    chainId: ALTANA_CHAIN_ID,
    permissions: buildSafeRebalancePermissions(),
    expiry,
    register: true,
  })

  const deadline = BigInt(Math.floor(Date.now() / 1000) + SAFE_REBALANCE_DEADLINE_SECONDS)
  const data = encodeFunctionData({
    abi: pancakeRouterAbi,
    functionName: 'swapExactETHForTokens',
    args: [
      quote.minimumOut,
      [BSC_TESTNET_WBNB, BSC_TESTNET_BUSD],
      profile.wallet.address,
      deadline,
    ],
  })

  onStage?.('executing')
  try {
    const execution = await altanaClient.execute({
      session: grant,
      chainId: ALTANA_CHAIN_ID,
      calls: [{ to: PANCAKE_V2_ROUTER, value: SAFE_REBALANCE_AMOUNT, data }],
    })
    const outputReceived = execution.status === 'CONFIRMED'
      ? await waitForBusdIncrease(profile.wallet.address, balanceBefore)
      : 0n
    return {
      session: grant,
      grant,
      quote,
      execution,
      outputReceived,
      executionError: execution.status === 'FAILED'
        ? 'The bounded PancakeSwap execution failed; the session remains revocable.'
        : undefined,
    }
  } catch (error) {
    return {
      session: grant,
      grant,
      quote,
      executionError: altanaErrorMessage(error),
    }
  }
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
