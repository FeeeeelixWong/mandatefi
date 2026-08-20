export type AgentCategory =
  | 'Rebalancing'
  | 'Grid Trading'
  | 'Yield Optimisation'
  | 'Health Factor'

export type RiskLevel = 'Low' | 'Medium' | 'High'

export interface AgentMetric {
  label: string
  value: string
  hint: string
}

export interface Agent {
  id: string
  name: string
  tagline: string
  category: AgentCategory
  risk: RiskLevel
  verified: boolean
  studioLive: boolean
  identity: string
  protocols: string[]
  fee: string
  successRate: number
  activeMandates: number
  managedValue: string
  updated: string
  primaryMetric: AgentMetric
  metrics: AgentMetric[]
  sparkline: number[]
  description: string
  safeguards: string[]
}

export interface Mandate {
  id: string
  agentId: string
  agentName: string
  budget: number
  duration: number
  protocols: string[]
  status: 'Active' | 'Revoked'
  createdAt: string
  chainId: number
  smartWallet: `0x${string}`
  sessionPublicKey: `0x${string}`
  expiry: number
  grantTxHash?: `0x${string}`
  verificationTxHash?: `0x${string}`
  verificationState?: 'CONFIRMED' | 'PENDING' | 'FAILED' | 'UNAVAILABLE'
  verificationError?: string
  revokeTxHash?: `0x${string}`
}
