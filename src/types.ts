export interface Mandate {
  id: string
  name: string
  goal: 'preserve' | 'balanced-growth' | 'maximize-growth'
  riskProfile: 'conservative' | 'balanced' | 'growth'
  managedAmount: string
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
  decisions: DecisionRecord[]
}

export interface DecisionRecord {
  id: string
  createdAt: string
  action: 'BUY_STABLE' | 'BUY_NATIVE' | 'HOLD'
  state: 'CONFIRMED' | 'FAILED' | 'POLICY_ONLY'
  rationale: string
  currentStableBps: number
  targetStableBps: number
  projectedStableBps: number
  amountIn: string
  inputAsset: 'tBNB' | 'BUSD'
  quotedOutput?: string
  minimumOutput?: string
  outputReceived?: string
  outputAsset: 'tBNB' | 'BUSD'
  transactionHash?: `0x${string}`
  reviewSource?: 'ACTIVATION' | 'MANUAL' | 'MONITOR'
  triggers?: string[]
  expertAction?: string
  confidence?: number
  gateStatus?: 'AUTO_EXECUTE' | 'APPROVAL_REQUIRED' | 'BLOCKED' | 'DEFERRED' | 'HOLD'
  promptVersion?: string
}
