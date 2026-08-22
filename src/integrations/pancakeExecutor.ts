import type { ExecuteResult, GrantSessionResult, Session, SessionPermissions } from '@altananetwork/sdk'
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  type Address,
  type Hex,
} from 'viem'
import type { PortfolioPlan, PortfolioSnapshot } from '../domain/portfolio'
import { GAS_RESERVE } from '../domain/portfolio'
import { allocationFor, type StrategyPlan } from '../domain/strategy'
import type { PancakeModule, PancakeModuleReceipt } from '../types'
import { bscTestnetClient } from '../lib/chains'
import { BSC_TESTNET_WBNB, stablecoinConfig, type StablecoinSymbol } from '../lib/tokens'
import {
  ALTANA_CHAIN_ID,
  altanaClient,
  altanaErrorMessage,
  minimumOutputFor,
  readAltanaBalance,
  readStablecoinBalance,
  type AltanaWalletProfile,
} from './altana'

export const PANCAKE_V2_ROUTER = getAddress('0xD99D1c33F9fC3444f8101754aBC46c52416550D1')
export const PANCAKE_TESTNET_CAKE = getAddress('0xFa60D973F7642B748046464e165A65B7323b0DEE')
export const PANCAKE_CAKE_WBNB_LP = getAddress('0xa96818CA65B57bEc2155Ba5c81a70151f63300CD')
export const PANCAKE_MASTERCHEF_V2 = getAddress('0xB4A466911556e39210a6bB2FaECBB59E4eB7E43d')
export const PANCAKE_CAKE_POOL = getAddress('0x683433ba14e8F26774D43D3E90DA6Dd7a22044Fe')
export const PANCAKE_CAKE_WBNB_PID = 4n

const DEADLINE_SECONDS = 20 * 60
const APPROVAL_BUFFER_BPS = 500n
const EXIT_SLIPPAGE_BPS = 500n

const routerAbi = [
  {
    name: 'getAmountsOut', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'amountIn', type: 'uint256' }, { name: 'path', type: 'address[]' }],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactETHForTokens', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' }, { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETH', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' }, { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'addLiquidityETH', type: 'function', stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' }, { name: 'amountTokenDesired', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' }, { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountToken', type: 'uint256' }, { name: 'amountETH', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
  },
  {
    name: 'removeLiquidityETH', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' }, { name: 'liquidity', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' }, { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' }, { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ name: 'amountToken', type: 'uint256' }, { name: 'amountETH', type: 'uint256' }],
  },
] as const

const erc20Abi = [
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'transfer', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const

const pairAbi = [
  ...erc20Abi,
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [],
    outputs: [{ name: 'reserve0', type: 'uint112' }, { name: 'reserve1', type: 'uint112' }, { name: 'timestamp', type: 'uint32' }],
  },
  { name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const masterChefAbi = [
  {
    name: 'deposit', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'pid', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [],
  },
  {
    name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'pid', type: 'uint256' }, { name: 'amount', type: 'uint256' }], outputs: [],
  },
  {
    name: 'userInfo', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'pid', type: 'uint256' }, { name: 'user', type: 'address' }],
    outputs: [{ name: 'amount', type: 'uint256' }, { name: 'rewardDebt', type: 'int256' }, { name: 'boostMultiplier', type: 'uint256' }],
  },
] as const

const cakePoolAbi = [
  {
    name: 'deposit', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }, { name: 'lockDuration', type: 'uint256' }], outputs: [],
  },
  {
    name: 'withdraw', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }], outputs: [],
  },
  {
    name: 'userInfo', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'shares', type: 'uint256' }, { name: 'lastDepositedTime', type: 'uint256' },
      { name: 'cakeAtLastUserAction', type: 'uint256' }, { name: 'lastUserActionTime', type: 'uint256' },
      { name: 'lockStartTime', type: 'uint256' }, { name: 'lockEndTime', type: 'uint256' },
      { name: 'userBoostedShare', type: 'uint256' }, { name: 'locked', type: 'bool' },
      { name: 'lockedAmount', type: 'uint256' },
    ],
  },
  { name: 'getPricePerFullShare', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

export type PancakeQuote = {
  amountIn: bigint
  quotedOut: bigint
  minimumOut: bigint
  router: Address
  path: readonly Address[]
}

export type PancakeDeploymentPlan = {
  stablecoin: StablecoinSymbol
  stableBalance: bigint
  reserveAmount: bigint
  marketAmount: bigint
  liquidityAmount: bigint
  earnAmount: bigint
  slippageBps: bigint
  marketQuote: PancakeQuote
  liquidityQuote: PancakeQuote
  liquidityCakeQuote: PancakeQuote
  earnQuote: PancakeQuote
  earnCakeQuote: PancakeQuote
  liquidityNativeForCake: bigint
  liquidityNativeForPair: bigint
  lpCakeDesired: bigint
  estimatedLp: bigint
  stableAllowance: bigint
  stableApprovalCap: bigint
  cakeRouterAllowance: bigint
  cakePoolAllowance: bigint
  lpAllowance: bigint
}

export type PancakePositionSnapshot = {
  stablecoin: StablecoinSymbol
  stableBalance: bigint
  nativeBalance: bigint
  cakeBalance: bigint
  lpWalletBalance: bigint
  farmStaked: bigint
  earnShares: bigint
  earnCakeValue: bigint
  observedAt: string
}

export type PancakeDeploymentProof = {
  session: GrantSessionResult
  grant: GrantSessionResult
  approval?: ExecuteResult
  deployment: PancakeDeploymentPlan
  receipts: PancakeModuleReceipt[]
  positions: PancakePositionSnapshot
}

export type PancakeExitProof = {
  stablecoin: StablecoinSymbol
  transactions: ExecuteResult[]
  receipts: PancakeModuleReceipt[]
  stableAmount: bigint
  cakeAmount: bigint
  nativeAmount: bigint
  transaction: ExecuteResult
}

function buffered(value: bigint) {
  return value * (10_000n + APPROVAL_BUFFER_BPS) / 10_000n + 1n
}

function strategyAmount(total: bigint, plan: StrategyPlan, sleeve: 'reserve' | 'market' | 'liquidity' | 'earn') {
  return total * BigInt(allocationFor(plan, sleeve)) / 10_000n
}

async function quote(router: Address, amountIn: bigint, path: readonly Address[], slippageBps: bigint): Promise<PancakeQuote> {
  if (amountIn <= 0n) throw new Error('Every live PancakeSwap sleeve requires a positive amount.')
  const amounts = await bscTestnetClient.readContract({
    address: router,
    abi: routerAbi,
    functionName: 'getAmountsOut',
    args: [amountIn, [...path]],
  })
  const quotedOut = amounts.at(-1)
  if (!quotedOut || quotedOut <= 0n) throw new Error('PancakeSwap returned no executable quote for a strategy sleeve.')
  return { amountIn, quotedOut, minimumOut: minimumOutputFor(quotedOut, slippageBps), router, path }
}

async function estimateLpTokens(cakeAmount: bigint, nativeAmount: bigint) {
  const [token0, reserves, totalSupply] = await Promise.all([
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_WBNB_LP, abi: pairAbi, functionName: 'token0' }),
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_WBNB_LP, abi: pairAbi, functionName: 'getReserves' }),
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_WBNB_LP, abi: pairAbi, functionName: 'totalSupply' }),
  ])
  const cakeIsToken0 = token0.toLowerCase() === PANCAKE_TESTNET_CAKE.toLowerCase()
  const cakeReserve = cakeIsToken0 ? reserves[0] : reserves[1]
  const nativeReserve = cakeIsToken0 ? reserves[1] : reserves[0]
  if (cakeReserve <= 0n || nativeReserve <= 0n || totalSupply <= 0n) {
    throw new Error('The official CAKE/WBNB testnet pair has no usable reserves.')
  }
  const byCake = cakeAmount * totalSupply / cakeReserve
  const byNative = nativeAmount * totalSupply / nativeReserve
  return byCake < byNative ? byCake : byNative
}

export async function preparePancakeDeployment(snapshot: PortfolioSnapshot, strategy: StrategyPlan): Promise<PancakeDeploymentPlan> {
  const stablecoin = stablecoinConfig(snapshot.stablecoin)
  const slippageBps = BigInt(strategy.guardrails.maximumSlippageBps)
  const reserveAmount = strategyAmount(snapshot.stableBalance, strategy, 'reserve')
  const marketAmount = strategyAmount(snapshot.stableBalance, strategy, 'market')
  const liquidityAmount = strategyAmount(snapshot.stableBalance, strategy, 'liquidity')
  const allocated = reserveAmount + marketAmount + liquidityAmount
  const earnAmount = snapshot.stableBalance > allocated ? snapshot.stableBalance - allocated : 0n
  const [marketQuote, liquidityQuote, earnQuote] = await Promise.all([
    quote(stablecoin.router, marketAmount, [stablecoin.address, BSC_TESTNET_WBNB], slippageBps),
    quote(stablecoin.router, liquidityAmount, [stablecoin.address, BSC_TESTNET_WBNB], slippageBps),
    quote(stablecoin.router, earnAmount, [stablecoin.address, BSC_TESTNET_WBNB], slippageBps),
  ])
  const liquidityNativeForCake = liquidityQuote.minimumOut / 2n
  const liquidityNativeForPair = liquidityQuote.minimumOut - liquidityNativeForCake
  const [liquidityCakeQuote, earnCakeQuote] = await Promise.all([
    quote(PANCAKE_V2_ROUTER, liquidityNativeForCake, [BSC_TESTNET_WBNB, PANCAKE_TESTNET_CAKE], slippageBps),
    quote(PANCAKE_V2_ROUTER, earnQuote.minimumOut, [BSC_TESTNET_WBNB, PANCAKE_TESTNET_CAKE], slippageBps),
  ])
  const lpCakeDesired = liquidityCakeQuote.minimumOut
  const estimatedLp = await estimateLpTokens(lpCakeDesired, liquidityNativeForPair)
  if (estimatedLp <= 0n) throw new Error('The CAKE/WBNB LP estimate is zero at this portfolio size.')

  return {
    stablecoin: snapshot.stablecoin,
    stableBalance: snapshot.stableBalance,
    reserveAmount,
    marketAmount,
    liquidityAmount,
    earnAmount,
    slippageBps,
    marketQuote,
    liquidityQuote,
    liquidityCakeQuote,
    earnQuote,
    earnCakeQuote,
    liquidityNativeForCake,
    liquidityNativeForPair,
    lpCakeDesired,
    estimatedLp,
    stableAllowance: marketAmount + liquidityAmount + earnAmount,
    stableApprovalCap: marketAmount + liquidityAmount + earnAmount,
    cakeRouterAllowance: buffered(lpCakeDesired),
    cakePoolAllowance: buffered(earnCakeQuote.quotedOut),
    lpAllowance: buffered(estimatedLp),
  }
}

export function buildPancakePermissions(deployment: PancakeDeploymentPlan, rebalance: PortfolioPlan): SessionPermissions {
  const stablecoin = stablecoinConfig(deployment.stablecoin)
  const nativeExecutionCap = deployment.liquidityQuote.minimumOut + deployment.earnQuote.minimumOut + rebalance.dailyNativeCap
  return {
    calls: [
      { to: stablecoin.router, signature: 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)' },
      { to: stablecoin.router, signature: 'swapExactETHForTokens(uint256,address[],address,uint256)' },
      { to: PANCAKE_V2_ROUTER, signature: 'swapExactETHForTokens(uint256,address[],address,uint256)' },
      { to: PANCAKE_V2_ROUTER, signature: 'addLiquidityETH(address,uint256,uint256,uint256,address,uint256)' },
      { to: PANCAKE_MASTERCHEF_V2, signature: 'deposit(uint256,uint256)' },
      { to: PANCAKE_CAKE_POOL, signature: 'deposit(uint256,uint256)' },
    ],
    spend: [
      { limit: nativeExecutionCap, period: 'day' },
      { limit: deployment.stableApprovalCap, period: 'day', token: stablecoin.address },
      { limit: deployment.cakeRouterAllowance + deployment.cakePoolAllowance, period: 'day', token: PANCAKE_TESTNET_CAKE },
      { limit: deployment.lpAllowance, period: 'day', token: PANCAKE_CAKE_WBNB_LP },
    ],
  }
}

function approvalCalls(token: Address, spender: Address, amount: bigint) {
  return [0n, amount].map((approvalAmount) => ({
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, approvalAmount] }),
  }))
}

export async function approvePancakeDeployment(profile: AltanaWalletProfile, deployment: PancakeDeploymentPlan) {
  const stablecoin = stablecoinConfig(deployment.stablecoin)
  const calls = [
    ...approvalCalls(stablecoin.address, stablecoin.router, deployment.stableApprovalCap),
    ...approvalCalls(PANCAKE_TESTNET_CAKE, PANCAKE_V2_ROUTER, deployment.cakeRouterAllowance),
    ...approvalCalls(PANCAKE_TESTNET_CAKE, PANCAKE_CAKE_POOL, deployment.cakePoolAllowance),
    ...approvalCalls(PANCAKE_CAKE_WBNB_LP, PANCAKE_MASTERCHEF_V2, deployment.lpAllowance),
    ...approvalCalls(PANCAKE_CAKE_WBNB_LP, PANCAKE_V2_ROUTER, deployment.lpAllowance),
  ]
  const result = await altanaClient.execute({ wallet: profile.wallet, signer: profile.signer, chainId: ALTANA_CHAIN_ID, calls })
  if (result.status === 'FAILED') throw new Error('The owner-bounded PancakeSwap approvals failed.')
  return result
}

async function tokenBalance(token: Address, account: Address) {
  return bscTestnetClient.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] })
}

async function waitForIncrease(read: () => Promise<bigint>, before: bigint) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const current = await read()
    if (current > before) return current - before
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
  return 0n
}

function receipt(
  module: PancakeModule,
  operation: PancakeModuleReceipt['operation'],
  contract: Address,
  note: string,
  result?: ExecuteResult,
  amounts?: Pick<PancakeModuleReceipt, 'inputAmount' | 'inputAsset' | 'outputAmount' | 'outputAsset'>,
  state?: PancakeModuleReceipt['state'],
): PancakeModuleReceipt {
  return {
    id: crypto.randomUUID(),
    module,
    operation,
    state: state ?? (result ? result.status === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED' : 'SKIPPED'),
    createdAt: new Date().toISOString(),
    contract,
    transactionHash: result?.transactionHash,
    note,
    ...amounts,
  }
}

function failedReceipt(
  module: PancakeModule,
  operation: PancakeModuleReceipt['operation'],
  contract: Address,
  error: unknown,
) {
  return receipt(module, operation, contract, altanaErrorMessage(error), undefined, undefined, 'FAILED')
}

function amount(value: bigint) {
  return formatUnits(value, 18)
}

async function executeSession(session: Session, calls: Array<{ to: Address; value: bigint; data: Hex }>) {
  const result = await altanaClient.execute({ session, chainId: ALTANA_CHAIN_ID, calls })
  if (result.status === 'FAILED') throw new Error('PancakeSwap reported a failed execution transaction.')
  return result
}

export async function readPancakePositions(address: Address, stablecoin: StablecoinSymbol): Promise<PancakePositionSnapshot> {
  const [stableBalance, nativeBalance, cakeBalance, lpWalletBalance, farmInfo, earnInfo, pricePerShare] = await Promise.all([
    readStablecoinBalance(address, stablecoin),
    readAltanaBalance(address),
    tokenBalance(PANCAKE_TESTNET_CAKE, address),
    tokenBalance(PANCAKE_CAKE_WBNB_LP, address),
    bscTestnetClient.readContract({ address: PANCAKE_MASTERCHEF_V2, abi: masterChefAbi, functionName: 'userInfo', args: [PANCAKE_CAKE_WBNB_PID, address] }),
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_POOL, abi: cakePoolAbi, functionName: 'userInfo', args: [address] }),
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_POOL, abi: cakePoolAbi, functionName: 'getPricePerFullShare' }),
  ])
  const earnShares = earnInfo[0]
  const grossEarnValue = earnShares * pricePerShare / 10n ** 18n
  return {
    stablecoin,
    stableBalance,
    nativeBalance,
    cakeBalance,
    lpWalletBalance,
    farmStaked: farmInfo[0],
    earnShares,
    earnCakeValue: grossEarnValue,
    observedAt: new Date().toISOString(),
  }
}

export async function deployPancakePortfolio(
  session: Session,
  deployment: PancakeDeploymentPlan,
  onStage?: (stage: 'executing') => void,
) {
  const receipts: PancakeModuleReceipt[] = []
  const stablecoin = stablecoinConfig(deployment.stablecoin)
  const wallet = session.walletAddress
  const deadline = BigInt(Math.floor(Date.now() / 1_000) + DEADLINE_SECONDS)
  onStage?.('executing')

  try {
    const nativeBefore = await readAltanaBalance(wallet)
    const result = await executeSession(session, [{
      to: stablecoin.router,
      value: 0n,
      data: encodeFunctionData({
        abi: routerAbi,
        functionName: 'swapExactTokensForETH',
        args: [deployment.marketAmount, deployment.marketQuote.minimumOut, [stablecoin.address, BSC_TESTNET_WBNB], wallet, deadline],
      }),
    }])
    const output = await waitForIncrease(() => readAltanaBalance(wallet), nativeBefore)
    receipts.push(receipt('SWAP', 'ALLOCATE', stablecoin.router, 'Built the market sleeve through the bounded stablecoin-to-tBNB route.', result, {
      inputAmount: amount(deployment.marketAmount), inputAsset: deployment.stablecoin,
      outputAmount: amount(output), outputAsset: 'tBNB',
    }))
  } catch (error) {
    receipts.push(failedReceipt('SWAP', 'ALLOCATE', stablecoin.router, error))
    return receipts
  }

  let mintedLp = 0n
  try {
    const lpBefore = await tokenBalance(PANCAKE_CAKE_WBNB_LP, wallet)
    const result = await executeSession(session, [
      {
        to: stablecoin.router,
        value: 0n,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: 'swapExactTokensForETH',
          args: [deployment.liquidityAmount, deployment.liquidityQuote.minimumOut, [stablecoin.address, BSC_TESTNET_WBNB], wallet, deadline],
        }),
      },
      {
        to: PANCAKE_V2_ROUTER,
        value: deployment.liquidityNativeForCake,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: 'swapExactETHForTokens',
          args: [deployment.liquidityCakeQuote.minimumOut, [BSC_TESTNET_WBNB, PANCAKE_TESTNET_CAKE], wallet, deadline],
        }),
      },
      {
        to: PANCAKE_V2_ROUTER,
        value: deployment.liquidityNativeForPair,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: 'addLiquidityETH',
          args: [
            PANCAKE_TESTNET_CAKE,
            deployment.lpCakeDesired,
            minimumOutputFor(deployment.lpCakeDesired, deployment.slippageBps),
            minimumOutputFor(deployment.liquidityNativeForPair, deployment.slippageBps),
            wallet,
            deadline,
          ],
        }),
      },
    ])
    mintedLp = await waitForIncrease(() => tokenBalance(PANCAKE_CAKE_WBNB_LP, wallet), lpBefore)
    receipts.push(receipt('LIQUIDITY', 'ADD_LIQUIDITY', PANCAKE_V2_ROUTER, 'Minted CAKE/WBNB V2 LP tokens through the official testnet router.', result, {
      inputAmount: amount(deployment.liquidityAmount), inputAsset: deployment.stablecoin,
      outputAmount: amount(mintedLp), outputAsset: 'CAKE-WBNB LP',
    }))
  } catch (error) {
    receipts.push(failedReceipt('LIQUIDITY', 'ADD_LIQUIDITY', PANCAKE_V2_ROUTER, error))
    return receipts
  }

  try {
    if (mintedLp <= 0n) throw new Error('No LP token was minted, so Farm staking was stopped.')
    const result = await executeSession(session, [{
      to: PANCAKE_MASTERCHEF_V2,
      value: 0n,
      data: encodeFunctionData({ abi: masterChefAbi, functionName: 'deposit', args: [PANCAKE_CAKE_WBNB_PID, mintedLp] }),
    }])
    receipts.push(receipt('FARM', 'STAKE_LP', PANCAKE_MASTERCHEF_V2, 'Staked the minted LP position in MasterChef V2 Farm PID 4.', result, {
      inputAmount: amount(mintedLp), inputAsset: 'CAKE-WBNB LP', outputAmount: amount(mintedLp), outputAsset: 'Farm shares',
    }))
  } catch (error) {
    receipts.push(failedReceipt('FARM', 'STAKE_LP', PANCAKE_MASTERCHEF_V2, error))
    return receipts
  }

  let earnedCake = 0n
  try {
    const cakeBefore = await tokenBalance(PANCAKE_TESTNET_CAKE, wallet)
    const result = await executeSession(session, [
      {
        to: stablecoin.router,
        value: 0n,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: 'swapExactTokensForETH',
          args: [deployment.earnAmount, deployment.earnQuote.minimumOut, [stablecoin.address, BSC_TESTNET_WBNB], wallet, deadline],
        }),
      },
      {
        to: PANCAKE_V2_ROUTER,
        value: deployment.earnQuote.minimumOut,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: 'swapExactETHForTokens',
          args: [deployment.earnCakeQuote.minimumOut, [BSC_TESTNET_WBNB, PANCAKE_TESTNET_CAKE], wallet, deadline],
        }),
      },
    ])
    earnedCake = await waitForIncrease(() => tokenBalance(PANCAKE_TESTNET_CAKE, wallet), cakeBefore)
    receipts.push(receipt('EARN', 'ALLOCATE', PANCAKE_V2_ROUTER, 'Converted the Earn sleeve to CAKE through the official V2 router.', result, {
      inputAmount: amount(deployment.earnAmount), inputAsset: deployment.stablecoin,
      outputAmount: amount(earnedCake), outputAsset: 'CAKE',
    }))
  } catch (error) {
    receipts.push(failedReceipt('EARN', 'ALLOCATE', PANCAKE_V2_ROUTER, error))
    return receipts
  }

  try {
    if (earnedCake <= 0n) throw new Error('No CAKE was received, so the Earn deposit was stopped.')
    const sharesBefore = (await bscTestnetClient.readContract({ address: PANCAKE_CAKE_POOL, abi: cakePoolAbi, functionName: 'userInfo', args: [wallet] }))[0]
    const result = await executeSession(session, [{
      to: PANCAKE_CAKE_POOL,
      value: 0n,
      data: encodeFunctionData({ abi: cakePoolAbi, functionName: 'deposit', args: [earnedCake, 0n] }),
    }])
    const shares = await waitForIncrease(async () => (await bscTestnetClient.readContract({ address: PANCAKE_CAKE_POOL, abi: cakePoolAbi, functionName: 'userInfo', args: [wallet] }))[0], sharesBefore)
    receipts.push(receipt('EARN', 'DEPOSIT_EARN', PANCAKE_CAKE_POOL, 'Deposited CAKE into the flexible CAKE Pool with a zero-second lock.', result, {
      inputAmount: amount(earnedCake), inputAsset: 'CAKE', outputAmount: amount(shares), outputAsset: 'CAKE Pool shares',
    }))
  } catch (error) {
    receipts.push(failedReceipt('EARN', 'DEPOSIT_EARN', PANCAKE_CAKE_POOL, error))
  }

  return receipts
}

export async function grantAndDeployPancakePortfolio(
  profile: AltanaWalletProfile,
  durationDays: number,
  strategy: StrategyPlan,
  snapshot: PortfolioSnapshot,
  rebalance: PortfolioPlan,
  executeApprovedPlan: boolean,
  onStage?: (stage: 'approving' | 'granting' | 'executing') => void,
): Promise<PancakeDeploymentProof> {
  const prepared = await preparePancakeDeployment(snapshot, strategy)
  const deployment = {
    ...prepared,
    stableApprovalCap: prepared.stableAllowance + rebalance.dailyStableCap,
  }
  let approval: ExecuteResult | undefined
  if (executeApprovedPlan) {
    onStage?.('approving')
    approval = await approvePancakeDeployment(profile, deployment)
  }
  onStage?.('granting')
  const grant = await altanaClient.grantSession({
    wallet: profile.wallet,
    signer: profile.signer,
    chainId: ALTANA_CHAIN_ID,
    permissions: buildPancakePermissions(deployment, rebalance),
    expiry: Math.floor(Date.now() / 1_000) + durationDays * 24 * 60 * 60,
    register: true,
  })
  const receipts = executeApprovedPlan ? await deployPancakePortfolio(grant, deployment, onStage) : []
  const positions = await readPancakePositions(profile.wallet.address, snapshot.stablecoin)
  return { session: grant, grant, approval, deployment, receipts, positions }
}

async function quoteLpRemovalMinimums(lpAmount: bigint) {
  const [token0, reserves, totalSupply] = await Promise.all([
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_WBNB_LP, abi: pairAbi, functionName: 'token0' }),
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_WBNB_LP, abi: pairAbi, functionName: 'getReserves' }),
    bscTestnetClient.readContract({ address: PANCAKE_CAKE_WBNB_LP, abi: pairAbi, functionName: 'totalSupply' }),
  ])
  if (totalSupply <= 0n) throw new Error('The CAKE/WBNB LP supply is unavailable for a protected exit quote.')
  const cakeIsToken0 = token0.toLowerCase() === PANCAKE_TESTNET_CAKE.toLowerCase()
  const cakeReserve = cakeIsToken0 ? reserves[0] : reserves[1]
  const nativeReserve = cakeIsToken0 ? reserves[1] : reserves[0]
  return {
    cakeMinimum: minimumOutputFor(lpAmount * cakeReserve / totalSupply, EXIT_SLIPPAGE_BPS),
    nativeMinimum: minimumOutputFor(lpAmount * nativeReserve / totalSupply, EXIT_SLIPPAGE_BPS),
  }
}

export async function exitPancakePortfolio(
  profile: AltanaWalletProfile,
  stablecoinSymbol: StablecoinSymbol,
  recipient: Address,
): Promise<PancakeExitProof> {
  const transactions: ExecuteResult[] = []
  const receipts: PancakeModuleReceipt[] = []
  let positions = await readPancakePositions(profile.wallet.address, stablecoinSymbol)

  if (positions.earnShares > 0n || positions.farmStaked > 0n) {
    const calls = []
    if (positions.earnShares > 0n) calls.push({
      to: PANCAKE_CAKE_POOL,
      value: 0n,
      data: encodeFunctionData({ abi: cakePoolAbi, functionName: 'withdraw', args: [positions.earnShares] }),
    })
    if (positions.farmStaked > 0n) calls.push({
      to: PANCAKE_MASTERCHEF_V2,
      value: 0n,
      data: encodeFunctionData({ abi: masterChefAbi, functionName: 'withdraw', args: [PANCAKE_CAKE_WBNB_PID, positions.farmStaked] }),
    })
    const result = await altanaClient.execute({ wallet: profile.wallet, signer: profile.signer, chainId: ALTANA_CHAIN_ID, calls })
    if (result.status === 'FAILED') throw new Error('The owner-authorized Farm/Earn withdrawal failed.')
    transactions.push(result)
    if (positions.earnShares > 0n) receipts.push(receipt('EARN', 'WITHDRAW', PANCAKE_CAKE_POOL, 'Withdrew all flexible CAKE Pool shares.', result))
    if (positions.farmStaked > 0n) receipts.push(receipt('FARM', 'WITHDRAW', PANCAKE_MASTERCHEF_V2, 'Withdrew all LP tokens and pending Farm rewards.', result))
    positions = await readPancakePositions(profile.wallet.address, stablecoinSymbol)
  }

  if (positions.lpWalletBalance > 0n) {
    const deadline = BigInt(Math.floor(Date.now() / 1_000) + DEADLINE_SECONDS)
    const { cakeMinimum, nativeMinimum } = await quoteLpRemovalMinimums(positions.lpWalletBalance)
    const calls = [
      ...approvalCalls(PANCAKE_CAKE_WBNB_LP, PANCAKE_V2_ROUTER, positions.lpWalletBalance),
      {
        to: PANCAKE_V2_ROUTER,
        value: 0n,
        data: encodeFunctionData({
          abi: routerAbi,
          functionName: 'removeLiquidityETH',
          args: [PANCAKE_TESTNET_CAKE, positions.lpWalletBalance, cakeMinimum, nativeMinimum, profile.wallet.address, deadline],
        }),
      },
    ]
    const result = await altanaClient.execute({ wallet: profile.wallet, signer: profile.signer, chainId: ALTANA_CHAIN_ID, calls })
    if (result.status === 'FAILED') throw new Error('The owner-authorized LP removal failed.')
    transactions.push(result)
    receipts.push(receipt('LIQUIDITY', 'REMOVE_LIQUIDITY', PANCAKE_V2_ROUTER, 'Removed all wallet-held CAKE/WBNB liquidity with reserve-derived minimum outputs.', result))
  }

  positions = await readPancakePositions(profile.wallet.address, stablecoinSymbol)
  const nativeAmount = positions.nativeBalance > GAS_RESERVE ? positions.nativeBalance - GAS_RESERVE : 0n
  const transferCalls = []
  if (positions.stableBalance > 0n) transferCalls.push({
    to: stablecoinConfig(stablecoinSymbol).address,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, positions.stableBalance] }),
  })
  if (positions.cakeBalance > 0n) transferCalls.push({
    to: PANCAKE_TESTNET_CAKE,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, positions.cakeBalance] }),
  })
  if (nativeAmount > 0n) transferCalls.push({ to: recipient, value: nativeAmount, data: '0x' as Hex })
  if (transferCalls.length === 0) throw new Error('The Passkey account has no available assets to return.')
  const transaction = await altanaClient.execute({ wallet: profile.wallet, signer: profile.signer, chainId: ALTANA_CHAIN_ID, calls: transferCalls })
  if (transaction.status === 'FAILED') throw new Error('The final owner asset return failed.')
  transactions.push(transaction)
  receipts.push(receipt('SWAP', 'WITHDRAW', stablecoinConfig(stablecoinSymbol).address, 'Returned all liquid wallet assets to the connected owner address.', transaction))

  return {
    stablecoin: stablecoinSymbol,
    transactions,
    receipts,
    stableAmount: positions.stableBalance,
    cakeAmount: positions.cakeBalance,
    nativeAmount,
    transaction,
  }
}
