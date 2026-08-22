import type { InvestmentCommittee } from './domain/investmentCommittee'
import type { PortfolioAsset } from './domain/portfolio'
import type { StablecoinSelectionEvidence } from './domain/stablecoinAllocator'
import type { StablecoinSymbol } from './lib/tokens'

export interface Mandate {
  id: string
  name: string
  goal: 'preserve' | 'balanced-growth' | 'maximize-growth'
  riskProfile: 'conservative' | 'balanced' | 'growth'
  stablecoin: StablecoinSymbol
  stablecoinSelection?: StablecoinSelectionEvidence
  managedAmount: string
  managedStableCap: string
  duration: number
  liquidityNeed?: 'anytime' | 'weekly' | 'term'
  strategyAllocations?: Record<'reserve' | 'market' | 'liquidity' | 'earn', number>
  modelYieldBps?: number
  strategyRiskScore?: number
  status: 'Active' | 'Paused' | 'Revoked'
  createdAt: string
  chainId: number
  smartWallet: `0x${string}`
  sessionPublicKey: `0x${string}`
  expiry: number
  targetStableBps: number
  driftBandBps: number
  maxSlippageBps: number
  dailyNativeCap: string
  dailyStableCap: string
  grantTxHash?: `0x${string}`
  revokeTxHash?: `0x${string}`
  exitTxHash?: `0x${string}`
  moduleReceipts?: PancakeModuleReceipt[]
  decisions: DecisionRecord[]
}

export type PancakeModule = 'SWAP' | 'LIQUIDITY' | 'FARM' | 'EARN'

export interface PancakeModuleReceipt {
  id: string
  module: PancakeModule
  operation: 'ALLOCATE' | 'ADD_LIQUIDITY' | 'STAKE_LP' | 'DEPOSIT_EARN' | 'WITHDRAW' | 'REMOVE_LIQUIDITY'
  state: 'CONFIRMED' | 'FAILED' | 'SKIPPED'
  createdAt: string
  contract: `0x${string}`
  transactionHash?: `0x${string}`
  inputAmount?: string
  inputAsset?: string
  outputAmount?: string
  outputAsset?: string
  note: string
}

export interface DecisionRecord {
  id: string
  createdAt: string
  action: 'BUY_STABLE' | 'BUY_NATIVE' | 'HOLD'
  purpose: 'INITIAL_NORMALIZATION' | 'PORTFOLIO_REBALANCE' | 'GAS_TOP_UP'
  state: 'CONFIRMED' | 'FAILED' | 'POLICY_ONLY'
  rationale: string
  currentStableBps: number
  targetStableBps: number
  projectedStableBps: number
  amountIn: string
  inputAsset: PortfolioAsset
  quotedOutput?: string
  minimumOutput?: string
  outputReceived?: string
  outputAsset: PortfolioAsset
  transactionHash?: `0x${string}`
  reviewSource?: 'ACTIVATION' | 'MANUAL' | 'MONITOR'
  triggers?: string[]
  expertAction?: string
  confidence?: number
  gateStatus?: 'AUTO_EXECUTE' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'DEFERRED' | 'HOLD'
  promptVersion?: string
  modelMode?: 'DEEPSEEK' | 'HYBRID_FALLBACK' | 'DETERMINISTIC_FALLBACK'
  modelName?: string
  agentRunId?: string
  agentInputHash?: string
  committee?: InvestmentCommittee
}
