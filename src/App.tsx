import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownUp, ArrowRight, BarChart3, BrainCircuit,
  BookOpen, Check, ChevronRight, CircleCheck,
  ExternalLink, Fingerprint, Fuel, Gauge, KeyRound, Layers3, LayoutDashboard,
  Leaf, LoaderCircle, Menu, Pause, Play, Plus, RefreshCw, Route, Search,
  Settings2, ShieldCheck, TrendingUp, Vault, Wallet, Waves, Workflow, X,
} from 'lucide-react'
import { formatEther, formatUnits, parseEther } from 'viem'
import type { Session } from '@altananetwork/sdk'
import {
  buildPortfolioPlan, formatNative, formatStable, GAS_LOW_WATERMARK, GAS_RESERVE, goalOptions,
  riskProfiles, type InvestmentGoal, type PortfolioPlan, type PortfolioSnapshot,
  type RiskProfileId,
} from './domain/portfolio'
import {
  allocationFor, buildStrategyPlan, formatBps, type ExecutionCoverage, type LiquidityNeed,
  type StrategyPlan, type StrategySleeveId,
} from './domain/strategy'
import {
  orchestrateStrategyReview,
  type StrategyOrchestratorContext,
  type StrategyReview,
} from './domain/strategyOrchestrator'
import {
  buildInvestmentCommittee,
  type ExecutionCostEstimate,
  type InvestmentCommittee,
} from './domain/investmentCommittee'
import type { ReviewSource } from './domain/triggerEngine'
import {
  buildStablecoinSelectionRequest,
  type StablecoinSelectionEvidence,
} from './domain/stablecoinAllocator'
import { useAltanaWallet, type AltanaStage } from './hooks/useAltanaWallet'
import { useInjectedWallet } from './hooks/useInjectedWallet'
import { BSC_TESTNET_EXPLORER_URL } from './lib/chains'
import { shortAddress, type InjectedWallet } from './lib/wallet'
import {
  DEFAULT_STABLECOIN, stablecoinConfig, type StablecoinSymbol,
} from './lib/tokens'
import type { AltanaNormalizationProof, AltanaPortfolioProof, PortfolioRebalanceQuote } from './integrations/altana'
import {
  fetchPancakeResearch,
  type PancakeResearchSnapshot,
} from './integrations/pancakeResearch'
import { fetchPancakeMarket, type PancakeMarketSnapshot } from './integrations/pancakeMarket'
import { requestDeepSeekReview } from './integrations/agentReview'
import { buildLocalStablecoinSelection, requestStablecoinSelection } from './integrations/stablecoinSelection'
import type { PancakeActivationProgress, PancakeDeploymentProof, PancakePositionSnapshot } from './integrations/pancakeExecutor'
import { completedPancakeModules, latestPancakeModuleReceipt } from './domain/pancakeReceipts'
import type { ActivationAttempt, DecisionRecord, Mandate } from './types'
import './App.css'

type View = 'overview' | 'create' | 'decisions' | 'policies' | 'about'
type MandateDraft = {
  amount: string
  stablecoin: StablecoinSymbol
  stablecoinSelection?: StablecoinSelectionEvidence
  duration: number
  goal: InvestmentGoal
  risk: RiskProfileId
  liquidityNeed: LiquidityNeed
}

const mandateStorageKey = 'mandatefi.portfolio-mandates.v5'
const activationStorageKey = 'mandatefi.activation-attempts.v1'

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Portfolio', icon: LayoutDashboard },
  { id: 'create', label: 'New strategy', icon: Plus },
  { id: 'decisions', label: 'Activity', icon: Activity },
  { id: 'policies', label: 'Guardrails', icon: ShieldCheck },
  { id: 'about', label: 'About', icon: BookOpen },
]

const altanaStageCopy: Record<AltanaStage, string> = {
  idle: 'Ready',
  creating: 'Creating passkey wallet...',
  recovering: 'Recovering passkey wallet...',
  funding: 'Funding the smart wallet...',
  normalizing: 'Converting tBNB into the AI-selected stablecoin...',
  approving: 'Authorizing bounded PancakeSwap adapters with your Passkey...',
  granting: 'Registering the scoped policy onchain...',
  executing: 'Deploying Swap, LP, Farm, and Earn positions...',
  revoking: 'Revoking the policy onchain...',
  withdrawing: 'Returning assets to the owner wallet...',
  error: 'Action required',
}

const activationPhaseCopy: Record<ActivationAttempt['phase'], string> = {
  PREPARING: 'Reading funded portfolio',
  NORMALIZING: 'Converting startup capital',
  REVIEWING: 'Running the investment committee',
  APPROVING: 'Registering owner allowances',
  GRANTING: 'Registering scoped policy',
  DEPLOYING: 'Deploying PancakeSwap modules',
  FAILED: 'Needs attention',
}

const liquidityOptions: Array<{ id: LiquidityNeed; name: string; description: string }> = [
  { id: 'anytime', name: 'Anytime', description: 'Keep more capital liquid for withdrawals.' },
  { id: 'weekly', name: 'Weekly', description: 'Balance liquidity with active yield positions.' },
  { id: 'term', name: 'At term', description: 'Allow more capital to work in LP and earn positions.' },
]

const toolNames = {
  'v2-router': 'PancakeSwap V2 Router',
  'v2-liquidity': 'CAKE/WBNB V2 LP',
  'masterchef-v2': 'MasterChef V2 · PID 4',
  'cake-pool': 'Flexible CAKE Pool',
} as const

function loadMandates(): Mandate[] {
  try {
    const current = localStorage.getItem(mandateStorageKey)
    const parsed = JSON.parse(current ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Mandate => Boolean(
      item && typeof item === 'object' && typeof item.name === 'string' &&
      typeof item.smartWallet === 'string' && Array.isArray(item.decisions),
    ))
  } catch {
    return []
  }
}

function loadActivationAttempts(): ActivationAttempt[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(activationStorageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ActivationAttempt => Boolean(
      item && typeof item === 'object' && typeof item.id === 'string' &&
      typeof item.smartWallet === 'string' && typeof item.phase === 'string',
    ))
  } catch {
    return []
  }
}

function safeParseStable(value: string) {
  try { return parseEther(value || '0') } catch { return 0n }
}

function safeParseNative(value: string) {
  try { return parseEther(value || '0') } catch { return 0n }
}

function txUrl(hash?: `0x${string}`) {
  return hash ? `${BSC_TESTNET_EXPLORER_URL}/tx/${hash}` : '#'
}

function allocationLabel(bps: bigint | number) {
  return `${Number(bps) / 100}%`
}

function formatProtocolAmount(value: bigint, maximumFractionDigits = 4) {
  if (value === 0n) return '0'
  const numeric = Number(formatUnits(value, 18))
  if (numeric > 0 && numeric < 10 ** -maximumFractionDigits) return `<${(10 ** -maximumFractionDigits).toFixed(maximumFractionDigits)}`
  return numeric.toLocaleString('en-US', { maximumFractionDigits })
}

function executionActionLabel(action: PortfolioPlan['action']) {
  if (action === 'BUY_STABLE') return 'Build liquid reserve'
  if (action === 'BUY_NATIVE') return 'Increase market exposure'
  return 'No swap required'
}

function coverageLabel(coverage: ExecutionCoverage) {
  return coverage === 'LIVE' ? 'Live executor' : 'Unavailable'
}

function buildDeploymentDecision(
  plan: PortfolioPlan,
  proof: PancakeDeploymentProof,
  review: StrategyReview,
): DecisionRecord {
  const completedModules = completedPancakeModules(proof.receipts)
  const confirmed = completedModules.size === 4 || proof.recoveredExistingPositions
  const failed = proof.receipts.some((item) => item.state === 'FAILED')
  const transactionHash = [...proof.receipts].reverse().find((item) => item.transactionHash)?.transactionHash ?? (proof.recoveredExistingPositions ? proof.grant.transactionHash : undefined)
  const modules = [...completedModules]
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: proof.recoveredExistingPositions ? 'HOLD' : 'BUY_NATIVE',
    purpose: 'PORTFOLIO_REBALANCE',
    state: confirmed ? 'CONFIRMED' : failed ? 'FAILED' : 'POLICY_ONLY',
    rationale: proof.recoveredExistingPositions
      ? 'Existing PancakeSwap positions were detected before execution. MandateFi preserved them without repeating a Swap, LP, Farm, or Earn allocation, then registered a replacement revocable AI session for continued monitoring and owner-controlled recovery.'
      : proof.receipts.length
      ? `The investment committee approved a typed initial deployment. Confirmed modules: ${modules.join(', ') || 'none'}. Each adapter has its own contract target, spend cap, receipt, position read, and owner exit path.`
      : `${review.recommendation.rationale} The policy was registered, but no DeFi module executed because the deterministic gate did not authorize deployment.`,
    currentStableBps: 10_000,
    targetStableBps: Number(plan.targetStableBps),
    projectedStableBps: Number(plan.targetStableBps),
    amountIn: proof.recoveredExistingPositions ? '0' : formatStable(proof.deployment.stableAllowance),
    inputAsset: proof.deployment.stablecoin,
    outputAsset: 'tBNB',
    transactionHash,
    reviewSource: review.source,
    triggers: review.triggers.map((trigger) => trigger.kind),
    expertAction: proof.recoveredExistingPositions ? 'RECOVER_EXISTING_PORTFOLIO' : 'DEPLOY_PANCAKE_PORTFOLIO',
    confidence: review.recommendation.confidence,
    gateStatus: review.gate.status,
    promptVersion: review.promptVersion,
    modelMode: review.modelMode,
    modelName: review.modelName,
    agentRunId: review.runId,
    agentInputHash: review.inputHash,
    committee: review.committee,
  }
}

function buildDecision(
  plan: PortfolioPlan,
  proof?: Pick<AltanaPortfolioProof, 'quote' | 'execution' | 'outputReceived' | 'executionError'>,
  review?: StrategyReview,
): DecisionRecord {
  const canExecute = review?.gate.status === 'AUTO_EXECUTE'
  const state = !canExecute || plan.action === 'HOLD' ? 'POLICY_ONLY' : proof?.execution?.status === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED'
  const rationale = review?.recommendation.rationale ?? plan.rationale
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: plan.action,
    purpose: plan.purpose,
    state,
    rationale: proof?.executionError ? `${rationale} Execution note: ${proof.executionError}` : rationale,
    currentStableBps: Number(plan.currentStableBps),
    targetStableBps: Number(plan.targetStableBps),
    projectedStableBps: Number(plan.projectedStableBps),
    amountIn: plan.inputAsset === 'tBNB' ? formatNative(plan.amountIn) : formatStable(plan.amountIn),
    inputAsset: plan.inputAsset,
    quotedOutput: proof?.quote ? (proof.quote.outputSymbol === 'tBNB' ? formatNative(proof.quote.quotedOut) : formatStable(proof.quote.quotedOut)) : undefined,
    minimumOutput: proof?.quote ? (proof.quote.outputSymbol === 'tBNB' ? formatNative(proof.quote.minimumOut) : formatStable(proof.quote.minimumOut)) : undefined,
    outputReceived: proof?.outputReceived !== undefined ? (plan.outputAsset === 'tBNB' ? formatNative(proof.outputReceived) : formatStable(proof.outputReceived)) : undefined,
    outputAsset: plan.outputAsset,
    transactionHash: proof?.execution?.transactionHash,
    reviewSource: review?.source,
    triggers: review?.triggers.map((trigger) => trigger.kind),
    expertAction: review?.recommendation.action,
    confidence: review?.recommendation.confidence,
    gateStatus: review?.gate.status,
    promptVersion: review?.promptVersion,
    modelMode: review?.modelMode,
    modelName: review?.modelName,
    agentRunId: review?.runId,
    agentInputHash: review?.inputHash,
    committee: review?.committee,
  }
}

function buildNormalizationDecision(
  proof: AltanaNormalizationProof,
  stablecoinSelection?: StablecoinSelectionEvidence,
): DecisionRecord {
  const selectionReason = stablecoinSelection
    ? ` The stablecoin allocation agent selected ${proof.stablecoin}: ${stablecoinSelection.rationale}`
    : ''
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: 'BUY_STABLE',
    purpose: 'INITIAL_NORMALIZATION',
    state: proof.transaction.status === 'CONFIRMED' ? 'CONFIRMED' : 'FAILED',
    rationale: `Owner funding was normalized from tBNB into ${proof.stablecoin}; ${formatNative(GAS_RESERVE)} tBNB remains protected for Gas. This startup conversion is owner-signed and separate from AI portfolio authority.${selectionReason}`,
    currentStableBps: 0,
    targetStableBps: 10_000,
    projectedStableBps: 10_000,
    amountIn: formatNative(proof.amountIn),
    inputAsset: 'tBNB',
    quotedOutput: formatStable(proof.quote.quotedOut),
    minimumOutput: formatStable(proof.quote.minimumOut),
    outputReceived: formatStable(proof.outputReceived),
    outputAsset: proof.stablecoin,
    transactionHash: proof.transaction.transactionHash,
    reviewSource: 'ACTIVATION',
    triggers: ['OWNER_FUNDING'],
    expertAction: 'STARTUP_CONVERSION',
    confidence: 100,
    gateStatus: 'APPROVAL_REQUIRED',
    promptVersion: stablecoinSelection?.promptVersion,
    modelMode: stablecoinSelection?.modelMode ?? 'DETERMINISTIC_FALLBACK',
    modelName: stablecoinSelection?.modelName ?? 'owner-passkey',
    agentInputHash: stablecoinSelection?.inputHash,
  }
}

function planForMandate(mandate: Mandate) {
  return buildStrategyPlan({
    goal: mandate.goal,
    risk: mandate.riskProfile,
    liquidityNeed: mandate.liquidityNeed ?? 'weekly',
    horizonDays: mandate.duration,
  })
}

async function orchestrateWithAgentRuntime(
  context: StrategyOrchestratorContext,
  snapshot: PortfolioSnapshot,
) {
  const fallbackReview = orchestrateStrategyReview(context)
  if (!fallbackReview.reviewNeeded || !context.committee) return fallbackReview

  try {
    const result = await requestDeepSeekReview({
      source: context.source,
      mandate: context.mandate,
      strategy: context.strategy,
      executionPlan: context.executionPlan,
      snapshot,
      activeTriggers: fallbackReview.triggers.map((trigger) => trigger.kind),
      baseCommittee: context.committee,
      fallbackRecommendation: fallbackReview.recommendation,
    })
    return orchestrateStrategyReview({
      ...context,
      committee: result.committee,
      recommendationOverride: result.recommendation,
      modelMetadata: {
        mode: result.modelMode,
        modelName: result.managerModel,
        runId: result.runId,
        inputHash: result.inputHash,
      },
    })
  } catch (error) {
    console.warn('DeepSeek review unavailable; using deterministic safety fallback.', error)
    return fallbackReview
  }
}

function StrategyBar({ plan }: { plan: StrategyPlan }) {
  return <div className="strategy-allocation" aria-label="AI strategy allocation">
    <div className="strategy-allocation-track">
      {plan.sleeves.map((sleeve) => <span key={sleeve.id} className={`sleeve-${sleeve.id}`} style={{ width: `${sleeve.allocationBps / 100}%` }} title={`${sleeve.name}: ${formatBps(sleeve.allocationBps)}`} />)}
    </div>
    <div className="strategy-allocation-legend">
      {plan.sleeves.map((sleeve) => <span key={sleeve.id}><i className={`sleeve-${sleeve.id}`} /><b>{sleeve.name}</b><strong>{formatBps(sleeve.allocationBps)}</strong></span>)}
    </div>
  </div>
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
}

function ProductHome({ onCreate }: { onCreate: () => void }) {
  return <div className="home-page">
    <section className="home-hero">
      <div className="hero-copy">
        <span className="product-kicker"><BrainCircuit size={16} /> Five-agent investment committee</span>
        <h1>Put your DeFi portfolio<br />on a clear strategy.</h1>
        <p>Deposit tBNB and set your goal, risk, and liquidity needs. MandateFi compares USDT and USDC, selects the stronger risk-adjusted base, reserves Gas, then runs a five-agent PancakeSwap portfolio inside your revocable mandate.</p>
        <div className="hero-actions"><button className="primary-button hero-button" onClick={onCreate}>Build my strategy <ArrowRight size={18} /></button><span><ShieldCheck size={16} /> No custody. No leverage. Revoke anytime.</span></div>
      </div>
      <div className="hero-workspace" aria-label="MandateFi product architecture">
        <header><div><span>AI operating model</span><strong>How AI manages your DeFi</strong></div><span className="network-pill"><i /> BNB Chain</span></header>
        <div className="home-architecture">
          <div className="architecture-input-grid">
            <section className="architecture-mandate">
              <span className="architecture-icon"><Settings2 size={19} /></span>
              <div><small>Owner funding + mandate</small><strong>tBNB → AI-selected stablecoin</strong></div>
              <div className="mandate-inputs" aria-label="Mandate inputs"><span>Passkey</span><span>AI picks base</span><span>Limits</span></div>
            </section>
            <section className="architecture-data">
              <span className="architecture-icon"><Activity size={19} /></span>
              <div><small>Live DeFi data</small><strong>Markets · yields · costs</strong></div>
              <span className="data-status"><i /> Live</span>
            </section>
          </div>

          <div className="architecture-connector" aria-hidden="true"><span /></div>

          <section className="architecture-team">
            <header><span><BrainCircuit size={17} /> 5 AI agents reason in parallel</span><small>Observe · analyze · report</small></header>
            <div className="architecture-agent-grid">
              {aboutAgents.map((agent, index) => { const Icon = agent.icon; return <div key={agent.name}><span><Icon size={16} /></span><b>{agent.name}</b><small>AI 0{index + 1}</small></div> })}
            </div>
          </section>

          <div className="architecture-connector" aria-hidden="true"><span /></div>

          <section className="architecture-reasoning">
            <div className="ai-synthesis">
              <span className="architecture-icon"><BrainCircuit size={19} /></span>
              <div><small>AI committee synthesis</small><strong>5 reports → 1 portfolio proposal</strong></div>
              <div className="reasoning-output" aria-label="Possible AI recommendations"><span>Hold</span><span>Rebalance</span><span>Ask owner</span></div>
            </div>
            <div className="architecture-policy-gate"><ShieldCheck size={18} /><span><small>Policy gate</small><strong>Code-enforced limits</strong></span></div>
          </section>

          <div className="architecture-connector" aria-hidden="true"><span /></div>

          <section className="architecture-execution">
            <div className="execution-brand"><Route size={19} /><span><small>Execution layer</small><strong>PancakeSwap</strong></span></div>
            <div className="execution-tools"><span><ArrowDownUp size={15} /> Swap</span><span><Waves size={15} /> Liquidity</span><span><Layers3 size={15} /> Farms</span><span><Leaf size={15} /> Earn</span></div>
          </section>
        </div>
        <footer><span><Wallet size={16} /> Owner-controlled wallet</span><strong>Monitor → Review → Execute onchain</strong></footer>
      </div>
    </section>
    <section className="product-proof" aria-label="Product capabilities">
      <div><BrainCircuit size={19} /><span><strong>Run a five-agent committee</strong><small>Market, LP, Farm, Earn, and cost AI agents report independently.</small></span></div>
      <div><Layers3 size={19} /><span><strong>Compose yield</strong><small>LP, Farm, and Earn allocations sized by return, liquidity, and IL risk.</small></span></div>
      <div><ShieldCheck size={19} /><span><strong>Enforce the mandate</strong><small>Contract scope, daily turnover, expiry, and emergency revoke stay explicit.</small></span></div>
    </section>
  </div>
}

const aboutAgents = [
  { name: 'Market', signal: 'Price + risk', icon: BarChart3 },
  { name: 'Pools', signal: 'Liquidity + IL', icon: Waves },
  { name: 'Farms', signal: 'Rewards + locks', icon: Layers3 },
  { name: 'Earn', signal: 'Yield + exits', icon: Leaf },
  { name: 'Costs', signal: 'Gas + slippage', icon: Fuel },
] as const

const aboutCoverage = [
  { name: 'Swap', status: 'Live', detail: 'Bounded V2 routes', icon: ArrowDownUp, tone: 'live' },
  { name: 'Liquidity', status: 'Live', detail: 'CAKE/WBNB V2 LP', icon: Waves, tone: 'live' },
  { name: 'Farms', status: 'Live', detail: 'MasterChef V2 PID 4', icon: Layers3, tone: 'live' },
  { name: 'Earn', status: 'Live', detail: 'Flexible CAKE Pool', icon: Leaf, tone: 'live' },
] as const

const aboutFaqs = [
  {
    question: 'How do funding and Gas work?',
    answer: 'You deposit tBNB into your Passkey smart account. The allocation agent compares USDT and USDC yield, liquidity, peg risk, and execution evidence. After you review its choice, an owner-signed startup transaction converts everything above the 0.003 tBNB Gas reserve. If Gas later falls below 0.0015 tBNB, a bounded stablecoin-to-tBNB refill restores the reserve and appears as a separate Activity record.',
  },
  {
    question: 'Does MandateFi custody my assets?',
    answer: 'No. Capital stays in the owner-controlled passkey smart wallet. MandateFi receives only scoped, expiring permissions that can be revoked onchain.',
  },
  {
    question: 'Can the AI trade any asset or call any contract?',
    answer: 'No. The model can only recommend typed actions. Contract targets, methods, spend caps, slippage, turnover, expiry, and adapter coverage are enforced outside the model.',
  },
  {
    question: 'Why is research on mainnet while execution is on testnet?',
    answer: 'Mainnet provides real PancakeSwap liquidity and yield evidence. The hackathon build proves bounded execution on BSC Testnet. Research never authorizes a transaction across networks.',
  },
  {
    question: 'When will MandateFi adjust a portfolio?',
    answer: 'A review starts after schedule, allocation drift, liquidity, yield, protocol-risk, expiry, cash-flow, or owner events. Execution proceeds only when fresh evidence and expected benefit clear every cost and policy gate.',
  },
] as const

function AboutPage({ onCreate }: { onCreate: () => void }) {
  return <div className="about-page">
    <header className="about-intro">
      <div>
        <span className="eyebrow">Product guide</span>
        <h1>You set the rules.<br />AI runs the strategy.</h1>
      </div>
      <div className="about-intro-copy">
        <p>One mandate. One 5-agent team. No custody.</p>
        <button className="primary-button" onClick={onCreate}>Build a strategy <ArrowRight size={16} /></button>
      </div>
    </header>

    <section className="about-section about-workflow">
      <div className="about-section-heading"><span className="eyebrow">How it works</span><h2>Four steps</h2></div>
      <div className="about-flow" aria-label="MandateFi operating workflow">
        <article><span><Wallet size={20} /></span><div><strong>Fund + set</strong><p>tBNB · goal · limits</p></div></article>
        <ChevronRight size={18} />
        <article><span><BrainCircuit size={20} /></span><div><strong>AI analyzes</strong><p>5-agent team</p></div></article>
        <ChevronRight size={18} />
        <article><span><ShieldCheck size={20} /></span><div><strong>Policy checks</strong><p>Allow · hold · block</p></div></article>
        <ChevronRight size={18} />
        <article><span><Route size={20} /></span><div><strong>PancakeSwap</strong><p>Execute · record</p></div></article>
      </div>
    </section>

    <section className="about-section about-team">
      <div className="about-section-heading"><span className="eyebrow">5-agent team</span><h2>Five AI agents.<br />One decision.</h2></div>
      <div className="agent-decision-map">
        <div className="about-agent-grid">{aboutAgents.map((agent, index) => { const Icon = agent.icon; return <article key={agent.name}><Icon size={20} /><b>AI Agent {String(index + 1).padStart(2, '0')}</b><strong>{agent.name}</strong><span>{agent.signal}</span></article> })}</div>
        <div className="agent-merge" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <div className="manager-decision"><BrainCircuit size={24} /><span><small>AI committee synthesis</small><strong>5 reports → 1 portfolio proposal</strong></span></div>
      </div>
    </section>

    <section className="about-section about-boundary">
      <div className="about-section-heading"><span className="eyebrow">Control</span><h2>AI advises.<br />Rules decide.</h2></div>
      <div className="boundary-grid">
        <article className="boundary-can"><header><CircleCheck size={20} /><strong>AI can</strong></header><div><span><Search size={18} />Scan</span><span><BarChart3 size={18} />Compare</span><span><Workflow size={18} />Recommend</span></div></article>
        <article className="boundary-cannot"><header><X size={20} /><strong>AI cannot</strong></header><div><span><Vault size={18} />Hold funds</span><span><KeyRound size={18} />Bypass rules</span><span><Plus size={18} />Raise limits</span></div></article>
      </div>
    </section>

    <section className="about-section about-coverage">
      <div className="about-section-heading"><span className="eyebrow">Today</span><h2>Execution coverage</h2></div>
      <div className="coverage-cards" aria-label="MandateFi execution coverage">{aboutCoverage.map((module) => { const Icon = module.icon; return <article key={module.name}><Icon size={22} /><span><strong>{module.name}</strong><small>{module.detail}</small></span><b className={`coverage-${module.tone}`}>{module.status}</b></article> })}</div>
    </section>

    <section className="about-section about-faq">
      <div className="about-section-heading"><span className="eyebrow">FAQ</span><h2>Questions</h2></div>
      <div className="faq-list">{aboutFaqs.map((faq) => <details key={faq.question}><summary><span>{faq.question}</span><ChevronRight size={17} /></summary><p>{faq.answer}</p></details>)}</div>
    </section>
  </div>
}

function PortfolioOverview({ mandate, snapshot, positions, executionPlan, pancakeResearch, pancakeMarket, loading, runtimeAvailable, checking, onCreate, onCheck, onOpenPolicies }: {
  mandate: Mandate | null
  snapshot: PortfolioSnapshot | null
  positions: PancakePositionSnapshot | null
  executionPlan: PortfolioPlan | null
  pancakeResearch: PancakeResearchSnapshot | null
  pancakeMarket: PancakeMarketSnapshot | null
  loading: boolean
  runtimeAvailable: boolean
  checking: boolean
  onCreate: () => void
  onCheck: () => void
  onOpenPolicies: () => void
}) {
  if (!mandate) return <ProductHome onCreate={onCreate} />
  const strategy = planForMandate(mandate)
  const latest = mandate.decisions[0]
  const mandateCapital = safeParseStable(mandate.managedStableCap)
  const recommendationTitle = latest?.expertAction ? latest.expertAction.replaceAll('_', ' ') : executionPlan ? executionActionLabel(executionPlan.action) : 'Reading portfolio'
  const gateStatus = latest?.gateStatus ?? (executionPlan?.action === 'HOLD' ? 'HOLD' : 'PENDING REVIEW')
  const liveFallbackCommittee = executionPlan
    ? buildInvestmentCommittee({ strategy, executionPlan, snapshot, pancakeResearch, pancakeMarket })
    : null
  const committee: InvestmentCommittee | null = latest?.committee ?? liveFallbackCommittee
  const marketNative = positions && positions.nativeBalance > GAS_RESERVE ? positions.nativeBalance - GAS_RESERVE : 0n
  const lpPosition = positions ? positions.lpWalletBalance + positions.farmStaked : 0n
  const moduleReceipt = (module: 'SWAP' | 'LIQUIDITY' | 'FARM' | 'EARN') => latestPancakeModuleReceipt(mandate.moduleReceipts, module)
  const confirmedModules = completedPancakeModules(mandate.moduleReceipts).size
  return <div className="dashboard-page">
    <div className="page-title-row"><div><span className="eyebrow">Managed strategy</span><h1>{mandate.name}</h1><p>{strategy.summary} Capital remains in the passkey smart wallet.</p></div><div className="title-actions"><button className="secondary-button" onClick={onOpenPolicies}><Settings2 size={16} /> Guardrails</button><button className="primary-button" disabled={checking || mandate.status !== 'Active'} onClick={onCheck}>{checking ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} Run live review</button></div></div>
    <section className="portfolio-hero-panel"><div className="portfolio-value-block"><span>Mandate capital</span><strong>{`${formatStable(mandateCapital)} ${mandate.stablecoin}`}</strong><small>Initial stable-value budget · normalized from {mandate.managedAmount} tBNB</small></div><Metric label="Gas reserve" value={loading ? 'Refreshing...' : snapshot ? `${formatNative(snapshot.nativeBalance)} tBNB` : 'Unavailable'} detail={`Auto-refill below ${formatNative(GAS_LOW_WATERMARK)} tBNB`} /><Metric label="Strategy risk" value={`${strategy.riskScore}/10`} detail={`${riskProfiles[mandate.riskProfile].name} mandate`} /><Metric label="Next review" value={strategy.reviewCadence} detail={runtimeAvailable ? 'Local executor online' : 'Owner approval required'} /></section>
    <div className="dashboard-layout">
      <section className="workspace-panel allocation-panel"><header className="panel-header"><div><span>AI portfolio construction</span><h2>Where the capital works</h2></div><span className="status-chip active"><i /> Active mandate</span></header><StrategyBar plan={strategy} /><div className="sleeve-grid">{strategy.sleeves.map((sleeve) => <article key={sleeve.id}><div className={`sleeve-icon sleeve-${sleeve.id}`}>{sleeve.id === 'reserve' ? <Vault size={18} /> : sleeve.id === 'market' ? <TrendingUp size={18} /> : sleeve.id === 'liquidity' ? <Waves size={18} /> : <Leaf size={18} />}</div><span>{sleeve.name}</span><strong>{formatBps(sleeve.allocationBps)}</strong><p>{sleeve.purpose}</p><small>{toolNames[sleeve.tool]}</small></article>)}</div></section>
      <aside className="workspace-panel ai-panel"><header className="panel-header"><div><span>Latest expert review</span><h2>{recommendationTitle}</h2></div><BrainCircuit size={23} /></header>{(latest || executionPlan) && <><p>{latest?.rationale ?? executionPlan?.rationale}</p>{latest?.triggers?.length ? <div className="trigger-chips" aria-label="Active review triggers">{latest.triggers.map((trigger) => <span key={trigger}>{trigger.replaceAll('_', ' ')}</span>)}</div> : <div className="trigger-chips"><span>NO ACTIVE EVENT RISK</span></div>}<div className="ai-signals"><div><span>Portfolio data</span><strong>{snapshot ? 'Live snapshot' : 'Waiting'}</strong></div><div><span>Reasoning</span><strong>{latest?.modelMode === 'DEEPSEEK' ? latest.modelName : latest?.modelMode === 'HYBRID_FALLBACK' ? 'DeepSeek + rules' : 'Rules fallback'}</strong></div><div><span>Confidence</span><strong>{latest?.confidence !== undefined ? `${latest.confidence}%` : '—'}</strong></div><div><span>Risk gate</span><strong>{gateStatus.replaceAll('_', ' ')}</strong></div></div><div className={`ai-decision ${latest?.gateStatus === 'AUTO_EXECUTE' ? 'trade' : 'hold'}`}>{latest?.gateStatus === 'AUTO_EXECUTE' ? <ArrowDownUp size={17} /> : <CircleCheck size={17} />}<span>{latest?.gateStatus === 'AUTO_EXECUTE' && executionPlan ? `${executionPlan.inputAsset} to ${executionPlan.outputAsset} adapter authorised` : latest?.gateStatus === 'APPROVAL_REQUIRED' ? 'Waiting for explicit owner approval' : latest?.gateStatus === 'BLOCKED' ? 'Recommendation blocked until its adapter is live' : latest?.gateStatus === 'DEFERRED' ? 'Execution delayed by the cooldown policy' : 'No automatic action authorised'}</span></div></>}</aside>
      {committee && <section className="workspace-panel committee-panel"><header className="panel-header"><div><span>Investment committee</span><h2>Five agents, one bounded decision</h2></div><span className="coverage-note">{committee.readyAgents}/5 current · {committee.modelMode === 'DEEPSEEK' ? 'DeepSeek agents' : committee.modelMode === 'HYBRID_FALLBACK' ? 'Hybrid reasoning' : 'Rules preview'}</span></header><div className="committee-summary"><div><span>Committee view</span><strong>{committee.summary}</strong></div><div><span>Execution cost</span><strong>{committee.executionCostBps === null ? 'Run live review' : formatBps(committee.executionCostBps)}</strong></div><div><span>Cost ceiling</span><strong>{formatBps(strategy.guardrails.maximumExecutionCostBps)}</strong></div><div><span>Best observed signal</span><strong>{committee.grossBenefitBps === null ? 'Not measurable' : formatBps(committee.grossBenefitBps - committee.riskCostBps)}</strong><small>24h annualized snapshot, not a forecast</small></div></div><div className="committee-grid">{committee.reports.map((report) => <article key={report.agentId}><div className="committee-agent-icon">{report.agentId === 'market' ? <BarChart3 size={17} /> : report.agentId === 'liquidity' ? <Waves size={17} /> : report.agentId === 'farms' ? <Layers3 size={17} /> : report.agentId === 'earn' ? <Leaf size={17} /> : <Fuel size={17} />}</div><div className="committee-agent-head"><strong>{report.name}</strong><span className={`agent-status agent-${report.status.toLowerCase()}`}>{report.status}</span></div><p>{report.headline}</p>{report.findings[0] && <span className="committee-evidence">{report.findings[0]}</span>}<footer><small>{report.inference?.mode === 'DEEPSEEK' ? 'DeepSeek' : 'Rules'} · Every {report.cadenceMinutes < 60 ? `${report.cadenceMinutes} min` : `${report.cadenceMinutes / 60} hr`}</small>{report.sourceUrl && <a href={report.sourceUrl} target="_blank" rel="noreferrer">{report.sourceLabel ?? 'Source'} <ExternalLink size={10} /></a>}</footer></article>)}</div></section>}
      <section className="workspace-panel positions-panel"><header className="panel-header"><div><span>Verified onchain positions</span><h2>Capital deployed by module</h2></div><span className={`status-chip ${confirmedModules === 4 ? 'active' : ''}`}><i /> {confirmedModules}/4 modules confirmed</span></header><div className="position-grid">
        <article><span className="position-icon reserve"><Vault size={18} /></span><div><small>Liquid reserve</small><strong>{positions ? `${formatProtocolAmount(positions.stableBalance)} ${mandate.stablecoin}` : 'Reading chain...'}</strong><p>Available in the Passkey wallet</p></div></article>
        <article><span className="position-icon market"><TrendingUp size={18} /></span><div><small>Market sleeve</small><strong>{positions ? `${formatProtocolAmount(marketNative)} tBNB` : 'Reading chain...'}</strong><p>{moduleReceipt('SWAP')?.state === 'CONFIRMED' ? 'Router receipt confirmed' : moduleReceipt('SWAP')?.state === 'FAILED' ? 'Router execution failed' : 'Awaiting deployment proof'}</p></div></article>
        <article><span className="position-icon liquidity"><Waves size={18} /></span><div><small>CAKE/WBNB LP</small><strong>{positions ? `${formatProtocolAmount(lpPosition, 6)} LP` : 'Reading chain...'}</strong><p>{moduleReceipt('LIQUIDITY')?.state === 'CONFIRMED' ? 'Liquidity minted onchain' : moduleReceipt('LIQUIDITY')?.state === 'FAILED' ? 'Liquidity execution failed' : 'Awaiting deployment proof'}</p></div></article>
        <article><span className="position-icon farm"><Layers3 size={18} /></span><div><small>MasterChef PID 4</small><strong>{positions ? positions.farmStaked > 0n ? 'Staked' : 'No stake' : 'Reading chain...'}</strong><p>{moduleReceipt('FARM')?.state === 'FAILED' ? 'Farm execution failed' : positions ? `${formatProtocolAmount(positions.farmStaked, 6)} LP earning rewards` : 'Farm position unavailable'}</p></div></article>
        <article><span className="position-icon earn"><Leaf size={18} /></span><div><small>Flexible CAKE Pool</small><strong>{positions ? `${formatProtocolAmount(positions.earnCakeValue, 6)} CAKE` : 'Reading chain...'}</strong><p>{moduleReceipt('EARN')?.state === 'FAILED' ? 'Earn execution failed' : positions ? `${formatProtocolAmount(positions.earnShares, 6)} shares` : 'Earn position unavailable'}</p></div></article>
      </div></section>
      <section className="workspace-panel action-panel"><header className="panel-header"><div><span>Execution plan</span><h2>PancakeSwap action queue</h2></div><span className="coverage-note">4 live adapters</span></header><div className="action-queue">{strategy.actions.map((action) => <article key={action.id}><span className="action-order">{action.order}</span><div className="action-copy"><div><strong>{action.title}</strong><span>{toolNames[action.tool]}</span></div><p>{action.detail}</p></div><div className="action-meta"><strong>{formatBps(action.allocationBps)}</strong><span className={`coverage coverage-${action.coverage.toLowerCase().replace('_', '-')}`}>{coverageLabel(action.coverage)}</span></div></article>)}</div></section>
      <aside className="workspace-panel policy-panel"><header className="panel-header"><div><span>Hard limits</span><h2>What AI cannot cross</h2></div><ShieldCheck size={22} /></header><dl className="policy-facts"><div><dt>Minimum liquid reserve</dt><dd>{formatBps(strategy.guardrails.minimumReserveBps)}</dd></div><div><dt>Maximum LP exposure</dt><dd>{formatBps(strategy.guardrails.maximumLiquidityBps)}</dd></div><div><dt>Single position cap</dt><dd>{formatBps(strategy.guardrails.maximumSinglePositionBps)}</dd></div><div><dt>Execution cost ceiling</dt><dd>{formatBps(strategy.guardrails.maximumExecutionCostBps)}</dd></div><div><dt>Leverage</dt><dd>Blocked</dd></div></dl>{latest && <div className="latest-proof"><span>Latest onchain proof</span><strong>{latest.state.replace('_', ' ')}</strong>{latest.transactionHash ? <a href={txUrl(latest.transactionHash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a> : <small>No transaction required</small>}</div>}</aside>
    </div>
    {!runtimeAvailable && mandate.status === 'Active' && <div className="runtime-notice"><AlertTriangle size={18} /><div><strong>The execution key is not available in this browser session.</strong><span>The onchain policy remains active and revocable. Create a replacement runtime to resume automatic reviews.</span></div><button onClick={onCreate}>Replace runtime</button></div>}
  </div>
}

function WalletPicker({
  open, wallets, selectedWalletId, connected, account, balance, balanceStatus, targetNetwork, status, error,
  onClose, onSelect, onSwitchNetwork, onRefresh, onClearError,
}: {
  open: boolean
  wallets: InjectedWallet[]
  selectedWalletId: string
  connected: boolean
  account: `0x${string}` | null
  balance: string | null
  balanceStatus: 'idle' | 'loading' | 'ready' | 'error'
  targetNetwork: boolean
  status: 'idle' | 'discovering' | 'connecting' | 'connected' | 'error'
  error: string
  onClose: () => void
  onSelect: (walletId: string) => Promise<void>
  onSwitchNetwork: () => Promise<boolean>
  onRefresh: () => Promise<void>
  onClearError: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => closeButton.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [onClose, open])

  if (!open) return null
  const connecting = status === 'connecting'
  const discovering = status === 'discovering' && wallets.length === 0

  return <div className="wallet-dialog-layer">
    <button className="wallet-dialog-backdrop" onClick={onClose} aria-label="Close wallet selection" />
    <section ref={dialogRef} className="wallet-dialog" role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title" aria-describedby="wallet-dialog-description">
      <header><div><span className="wallet-dialog-icon"><Wallet size={20} /></span><span><h2 id="wallet-dialog-title">Connect a wallet</h2><p id="wallet-dialog-description">Choose an installed wallet for funding and owner approvals.</p></span></div><button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close wallet selection"><X size={18} /></button></header>
      <div className="wallet-dialog-body">
        {discovering && <div className="wallet-discovery" aria-live="polite"><span /><span /><span /></div>}
        {!discovering && wallets.length === 0 && <div className="wallet-empty"><Wallet size={28} /><strong>No wallet detected</strong><p>Install or enable an EVM browser wallet, then reload this page.</p><button className="secondary-button" onClick={() => window.location.reload()}><RefreshCw size={15} /> Reload</button></div>}
        {wallets.length > 0 && <div className="wallet-options" aria-label="Detected wallets">{wallets.map((walletOption) => {
          const active = selectedWalletId === walletOption.id
          return <button key={walletOption.id} className={active ? 'active' : ''} disabled={connecting} aria-busy={connecting && active} onClick={() => void onSelect(walletOption.id)}>
            <span className="wallet-option-icon">{walletOption.icon ? <img src={walletOption.icon} alt="" /> : <Wallet size={20} />}</span>
            <span><strong>{walletOption.name}</strong><small>{walletOption.rdns ?? 'Injected EVM wallet'}</small></span>
            {connecting && active ? <LoaderCircle className="spin" size={18} /> : active && connected ? <span className="wallet-connected"><Check size={14} /> Connected</span> : <ChevronRight size={18} />}
          </button>
        })}</div>}
        {connected && targetNetwork && account && <div className="wallet-account-summary" aria-live="polite"><span className="wallet-account-icon"><Wallet size={18} /></span><span><small>Available wallet balance</small><strong>{balanceStatus === 'loading' ? 'Reading balance...' : balanceStatus === 'error' ? 'Balance unavailable' : `${balance ?? '0'} tBNB`}</strong><code>{shortAddress(account)}</code></span><button className="icon-button" disabled={balanceStatus === 'loading'} onClick={() => void onRefresh()} aria-label="Refresh wallet balance"><RefreshCw className={balanceStatus === 'loading' ? 'spin' : ''} size={16} /></button></div>}
        {connected && !targetNetwork && <div className="wallet-network-action"><AlertTriangle size={17} /><span><strong>Wrong network</strong><small>MandateFi currently executes on BNB Smart Chain Testnet.</small></span><button onClick={() => void onSwitchNetwork()}>Switch network</button></div>}
        {error && <div className="wallet-dialog-error" role="alert"><AlertTriangle size={16} /><span>{error}</span><button onClick={onClearError} aria-label="Dismiss wallet error"><X size={14} /></button></div>}
      </div>
      <footer><ShieldCheck size={15} /><span>EIP-6963 and injected wallets supported: OKX, MetaMask, Rabby, Coinbase, Trust, Binance, Phantom, and more.</span></footer>
    </section>
  </div>
}

function MandateWizard({
  snapshotLoading, account, isTargetNetwork, walletError, walletName, walletBalance, walletBalanceStatus,
  altanaAddress, altanaBalance, altanaBalanceWei, altanaStage, altanaError,
  pancakeResearch, pancakeMarket,
  isPasskeySupported, onConnect, onSwitchNetwork, onCreateAltana, onRecoverAltana,
  onFundAltana, onStart, onCancel,
}: {
  snapshotLoading: boolean
  account: `0x${string}` | null
  isTargetNetwork: boolean
  walletError: string
  walletName: string
  walletBalance: string | null
  walletBalanceStatus: 'idle' | 'loading' | 'ready' | 'error'
  altanaAddress: `0x${string}` | null
  altanaBalance: string
  altanaBalanceWei: bigint | null
  altanaStage: AltanaStage
  altanaError: string
  pancakeResearch: PancakeResearchSnapshot | null
  pancakeMarket: PancakeMarketSnapshot | null
  isPasskeySupported: boolean
  onConnect: () => void
  onSwitchNetwork: () => void
  onCreateAltana: () => void
  onRecoverAltana: () => void
  onFundAltana: (draft: MandateDraft) => Promise<void>
  onStart: (draft: MandateDraft) => Promise<void>
  onCancel: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [draft, setDraft] = useState<MandateDraft>({ amount: '', stablecoin: DEFAULT_STABLECOIN, duration: 30, goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly' })
  const [quote, setQuote] = useState<PortfolioRebalanceQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [selectingStablecoin, setSelectingStablecoin] = useState(false)
  const [stablecoinError, setStablecoinError] = useState('')
  const [amountTouched, setAmountTouched] = useState(false)
  const [smartStableBalance, setSmartStableBalance] = useState(0n)
  const fundingAmount = safeParseNative(draft.amount)
  const estimatedNativeForConversion = fundingAmount > GAS_RESERVE ? fundingAmount - GAS_RESERVE : 0n
  const planningBnbPrice = parseEther((pancakeMarket?.pricesUsd.bnb ?? 500).toFixed(6))
  const managedAmount = estimatedNativeForConversion * planningBnbPrice / parseEther('1')
  const selectedStable = stablecoinConfig(draft.stablecoin)
  const planningSnapshot = useMemo<PortfolioSnapshot>(() => ({
    nativeBalance: GAS_RESERVE,
    stableBalance: managedAmount,
    stablecoin: draft.stablecoin,
    priceStablePerNative: parseEther('500'),
    updatedAt: new Date().toISOString(),
  }), [draft.stablecoin, managedAmount])
  const strategy = useMemo(() => buildStrategyPlan({ goal: draft.goal, risk: draft.risk, liquidityNeed: draft.liquidityNeed, horizonDays: draft.duration }), [draft])
  const executionPlan = useMemo(() => buildPortfolioPlan({ snapshot: planningSnapshot, managedAmount, goal: draft.goal, risk: draft.risk, targetReserveBps: BigInt(allocationFor(strategy, 'reserve')) }), [draft.goal, draft.risk, managedAmount, planningSnapshot, strategy])
  const usableQuote = quote?.amountIn === executionPlan.amountIn && quote.inputSymbol === executionPlan.inputAsset ? quote : null
  const busy = starting || selectingStablecoin || !['idle', 'error'].includes(altanaStage)
  const amountValid = fundingAmount > GAS_RESERVE
  const fundingReady = (altanaBalanceWei ?? 0n) >= fundingAmount || (smartStableBalance > 0n && (altanaBalanceWei ?? 0n) >= GAS_RESERVE)
  const ready = Boolean(account && isTargetNetwork && altanaAddress && fundingReady && draft.stablecoinSelection)
  const selectedGoal = goalOptions.find((goal) => goal.id === draft.goal) ?? goalOptions[1]
  const selectedRisk = riskProfiles[draft.risk]
  const selectedCandidate = draft.stablecoinSelection?.candidates.find((candidate) => candidate.symbol === draft.stablecoin)

  function updateDraft(patch: Partial<MandateDraft>) {
    setDraft((current) => ({ ...current, ...patch, stablecoinSelection: undefined }))
    setStablecoinError('')
  }

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [step])

  const refreshStableBalances = useCallback(async () => {
    if (!draft.stablecoinSelection) { setSmartStableBalance(0n); return }
    const { readStablecoinBalance } = await import('./integrations/altana')
    const smart = altanaAddress ? await readStablecoinBalance(altanaAddress, draft.stablecoin) : 0n
    setSmartStableBalance(smart)
  }, [altanaAddress, draft.stablecoin, draft.stablecoinSelection])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshStableBalances() }, 0)
    const interval = window.setInterval(() => { void refreshStableBalances() }, 15_000)
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(interval) }
  }, [refreshStableBalances])

  useEffect(() => {
    if (!draft.stablecoinSelection || executionPlan.action === 'HOLD') return
    let active = true
    void import('./integrations/altana')
      .then(({ quotePortfolioPlan }) => quotePortfolioPlan(executionPlan))
      .then((next) => { if (active) { setQuote(next); setQuoteError('') } })
      .catch((error: unknown) => { if (active) setQuoteError(error instanceof Error ? error.message : 'Live swap quote unavailable.') })
    return () => { active = false }
  }, [draft.stablecoinSelection, executionPlan])

  async function generateStrategy() {
    if (!amountValid) { setAmountTouched(true); return }
    setSelectingStablecoin(true)
    setStablecoinError('')
    try {
      const [market, research] = await Promise.all([
        pancakeMarket ? Promise.resolve(pancakeMarket) : fetchPancakeMarket(),
        pancakeResearch ? Promise.resolve(pancakeResearch) : fetchPancakeResearch(),
      ])
      const { quoteFundingNormalization } = await import('./integrations/altana')
      const symbols = ['USDT', 'USDC'] as const
      const quoteResults = await Promise.allSettled(symbols.map((symbol) => quoteFundingNormalization(symbol, estimatedNativeForConversion)))
      const quoteRates = Object.fromEntries(quoteResults.map((result, index) => {
        if (result.status === 'rejected' || result.value.amountIn === 0n) return [symbols[index], null]
        const scaled = result.value.quotedOut * parseEther('1') / result.value.amountIn
        return [symbols[index], Number(formatUnits(scaled, 18))]
      })) as Partial<Record<StablecoinSymbol, number | null>>
      const input = buildStablecoinSelectionRequest({
        goal: draft.goal,
        riskProfile: draft.risk,
        liquidityNeed: draft.liquidityNeed,
        horizonDays: draft.duration,
        market,
        research,
        quoteRates,
      })
      let selection: StablecoinSelectionEvidence
      try {
        selection = await requestStablecoinSelection(input)
      } catch {
        selection = await buildLocalStablecoinSelection(input)
      }
      setDraft((current) => ({ ...current, stablecoin: selection.stablecoin, stablecoinSelection: selection }))
      setStep(2)
    } catch (error) {
      setStablecoinError(error instanceof Error ? error.message : 'The stablecoin allocation agent could not compare current opportunities.')
    } finally {
      setSelectingStablecoin(false)
    }
  }

  async function start() {
    setStarting(true)
    setStartError('')
    try {
      await onStart(draft)
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Strategy activation did not complete.')
    } finally {
      setStarting(false)
    }
  }

  return <div className="configurator-page">
    <header className="configurator-header"><button className="icon-button" disabled={busy} onClick={onCancel} aria-label="Back to portfolio"><X size={18} /></button><div><span className="eyebrow">New managed strategy</span><h1>Tell the AI how your capital should work</h1><p>MandateFi composes the strategy first. Wallet authority is requested only after you review it.</p></div></header>
    <nav className="setup-progress" aria-label="Strategy setup progress">
      {[{ id: 1, name: 'Preferences', detail: 'Goal, risk and access' }, { id: 2, name: 'Strategy', detail: 'Allocation and actions' }, { id: 3, name: 'Approve', detail: 'Wallet and policy' }].map((item, index) => <div className="progress-item" key={item.id}><button className={step === item.id ? 'active' : step > item.id ? 'complete' : ''} disabled={step < item.id} onClick={() => setStep(item.id as 1 | 2 | 3)}><span>{step > item.id ? <Check size={14} /> : item.id}</span><div><strong>{item.name}</strong><small>{item.detail}</small></div></button>{index < 2 && <i />}</div>)}
    </nav>
    <div className="configurator-grid">
      <section className="configurator-card">
        {step === 1 && <>
          <div className="config-section first"><div className="config-section-heading"><span>Fund with tBNB</span><small>Enter the amount yourself. MandateFi does not suggest or cap the deposit size.</small></div><label className="amount-field" htmlFor="managed-capital"><span>Funding amount</span><div><input id="managed-capital" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="Enter amount" value={draft.amount} onBlur={() => setAmountTouched(true)} onChange={(event) => updateDraft({ amount: event.target.value })} aria-invalid={amountTouched && !amountValid} aria-describedby="capital-help" /><b>tBNB</b></div><small id="capital-help" className={amountTouched && !amountValid ? 'field-error' : ''}>{amountTouched && !amountValid ? `Enter more than ${formatNative(GAS_RESERVE)} tBNB so investable capital remains after the Gas reserve.` : `No fixed maximum. ${formatNative(GAS_RESERVE)} tBNB stays available for Gas; wallet balance and the live route determine executable size.`}</small></label><div className="ai-stablecoin-delegation"><span><BrainCircuit size={18} /></span><div><strong>AI chooses the base stablecoin</strong><p>The allocation agent compares USDT and USDC yield, TVL, peg stability, eligible pools, and the live PancakeSwap route after you submit these preferences.</p></div><div className="stablecoin-candidates" aria-label="Stablecoins evaluated by AI"><span>USDT</span><span>USDC</span></div></div><p className="selection-explainer"><Search size={15} /> You choose the mandate. The agent chooses the stronger risk-adjusted stablecoin and shows its evidence before permission is requested.</p></div>
          <div className="config-section"><div className="config-section-heading"><span>Outcome</span><small>What should the AI optimise for?</small></div><fieldset className="option-field"><legend>Primary objective</legend><div>{goalOptions.map((goal) => <button type="button" aria-pressed={draft.goal === goal.id} key={goal.id} className={draft.goal === goal.id ? 'active' : ''} onClick={() => updateDraft({ goal: goal.id })}><strong>{goal.name}</strong><small>{goal.description}</small></button>)}</div></fieldset></div>
          <div className="config-section"><div className="config-section-heading"><span>Risk tolerance</span><small>Controls position sizing and hard limits</small></div><fieldset className="segmented-field"><legend>Risk tolerance</legend><div>{Object.values(riskProfiles).map((risk) => <button type="button" aria-pressed={draft.risk === risk.id} key={risk.id} className={draft.risk === risk.id ? 'active' : ''} onClick={() => updateDraft({ risk: risk.id })}>{risk.name}</button>)}</div></fieldset><p className="selection-explainer"><Gauge size={15} /> {selectedRisk.description}</p></div>
          <div className="config-section config-pair"><div><div className="config-section-heading"><span>Withdrawal access</span></div><fieldset className="segmented-field"><legend>Withdrawal access</legend><div>{liquidityOptions.map((option) => <button type="button" aria-pressed={draft.liquidityNeed === option.id} key={option.id} className={draft.liquidityNeed === option.id ? 'active' : ''} onClick={() => updateDraft({ liquidityNeed: option.id })}>{option.name}</button>)}</div></fieldset><p className="field-note">{liquidityOptions.find((item) => item.id === draft.liquidityNeed)?.description}</p></div><div><div className="config-section-heading"><span>Strategy horizon</span></div><fieldset className="segmented-field"><legend>Strategy horizon</legend><div>{[7, 14, 30].map((days) => <button type="button" aria-pressed={draft.duration === days} key={days} className={draft.duration === days ? 'active' : ''} onClick={() => updateDraft({ duration: days })}>{days} days</button>)}</div></fieldset></div></div>
          {stablecoinError && <div className="inline-error"><AlertTriangle size={16} /><span>{stablecoinError} Check the live data connection and retry.</span></div>}
          <footer className="config-actions"><div><ShieldCheck size={17} /><span>No wallet permission is requested yet.</span></div><button className="primary-button" disabled={!amountValid || selectingStablecoin} aria-busy={selectingStablecoin} onClick={() => void generateStrategy()}>{selectingStablecoin ? <LoaderCircle className="spin" size={16} /> : <BrainCircuit size={17} />} {selectingStablecoin ? 'Comparing USDT and USDC...' : 'Generate strategy'}</button></footer>
        </>}

        {step === 2 && <>
          <div className="strategy-review-intro"><span className="eyebrow">AI recommendation</span><h2>{selectedGoal.name} across four strategy sleeves</h2><p>{strategy.summary}</p></div>
          {draft.stablecoinSelection && selectedCandidate && <section className="stablecoin-recommendation" aria-label="AI stablecoin recommendation"><div className="stablecoin-recommendation-icon"><BrainCircuit size={21} /></div><div className="stablecoin-recommendation-copy"><span>Base asset selected by AI</span><div><h3>{draft.stablecoin}</h3><b>{draft.stablecoinSelection.confidence}% confidence</b><em>{draft.stablecoinSelection.modelMode === 'DEEPSEEK' ? 'DeepSeek allocator' : 'Rules fallback'}</em></div><p>{draft.stablecoinSelection.rationale}</p><div className="stablecoin-factor-list">{draft.stablecoinSelection.keyFactors.map((factor) => <span key={factor}><Check size={12} /> {factor}</span>)}</div></div><aside><span>Observed opportunity</span><strong>{(selectedCandidate.bestOpportunityAprBps / 100).toFixed(2)}%</strong><small>APR · not guaranteed</small><span>Pool or farm TVL</span><strong>${(selectedCandidate.bestOpportunityTvlUsd / 1_000_000).toFixed(2)}m</strong><small>{selectedCandidate.bestOpportunityPair}</small></aside></section>}
          <div className="strategy-review-allocation"><StrategyBar plan={strategy} /></div>
          <div className="review-actions">{strategy.actions.map((action) => <article key={action.id}><span className="action-order">{action.order}</span><div><strong>{action.title}</strong><p>{action.detail}</p><small>{toolNames[action.tool]}</small></div><aside><b>{formatBps(action.allocationBps)}</b><span className={`coverage coverage-${action.coverage.toLowerCase().replace('_', '-')}`}>{coverageLabel(action.coverage)}</span></aside></article>)}</div>
          <details className="advanced-policy"><summary><ShieldCheck size={17} /><span><strong>Hard policy limits</strong><small>These limits override every AI recommendation</small></span><ChevronRight size={16} /></summary><div className="advanced-policy-grid"><div><span>Minimum reserve</span><strong>{formatBps(strategy.guardrails.minimumReserveBps)}</strong></div><div><span>Maximum LP</span><strong>{formatBps(strategy.guardrails.maximumLiquidityBps)}</strong></div><div><span>Maximum slippage</span><strong>{formatBps(strategy.guardrails.maximumSlippageBps)}</strong></div><div><span>Leverage</span><strong>Blocked</strong></div></div></details>
          {quoteError && <div className="inline-warning"><AlertTriangle size={16} /><span>The strategy remains reviewable, but the live testnet Swap quote is unavailable: {quoteError}</span></div>}
          <footer className="config-actions"><button className="secondary-button" onClick={() => setStep(1)}>Edit preferences</button><button className="primary-button" onClick={() => setStep(3)}>Review permissions <ArrowRight size={17} /></button></footer>
        </>}

        {step === 3 && <>
          <div className="approval-intro"><span className="eyebrow">Owner approval</span><h2>Fund once, deploy four modules</h2><p>tBNB enters your Passkey smart account. After stablecoin allocation, your Passkey authorizes bounded allowances to the official V2 Router, MasterChef V2, and CAKE Pool. The revocable AI session cannot call approve.</p></div>
          <div className="approval-checklist">
            <div className={account && isTargetNetwork ? 'complete' : ''}><span>{account && isTargetNetwork ? <Check size={16} /> : <Wallet size={16} />}</span><div><strong>Funding wallet</strong><small>{account ? `${walletName} · ${shortAddress(account)} · ${!isTargetNetwork ? 'wrong network' : walletBalanceStatus === 'loading' ? 'reading balance' : walletBalanceStatus === 'error' ? 'balance unavailable' : `${walletBalance ?? '0'} tBNB available`}` : 'Choose an installed wallet'}</small></div>{!account ? <button onClick={onConnect}>Connect</button> : !isTargetNetwork ? <button onClick={onSwitchNetwork}>Switch</button> : null}</div>
            <div className={altanaAddress ? 'complete' : ''}><span>{altanaAddress ? <Check size={16} /> : <Fingerprint size={16} />}</span><div><strong>Passkey smart wallet</strong><small>{altanaAddress ? shortAddress(altanaAddress) : 'Owner-controlled account'}</small></div>{!altanaAddress && <div className="inline-actions"><button disabled={!isPasskeySupported || busy} onClick={onCreateAltana}>Create</button><button disabled={!isPasskeySupported || busy} onClick={onRecoverAltana}>Recover</button></div>}</div>
            <div className={fundingReady ? 'complete' : ''}><span>{fundingReady ? <Check size={16} /> : <Vault size={16} />}</span><div><strong>tBNB funding</strong><small>{altanaAddress ? `${altanaBalance} tBNB available · target ${draft.amount || '0'} tBNB` : 'Fund after wallet creation'}</small></div>{altanaAddress && !fundingReady && <button disabled={busy || !account || !amountValid} onClick={() => void onFundAltana(draft)}>Deposit missing tBNB</button>}</div>
            <div className={smartStableBalance > 0n ? 'complete' : ''}><span>{smartStableBalance > 0n ? <Check size={16} /> : <ArrowDownUp size={16} />}</span><div><strong>AI-selected startup conversion</strong><small>{smartStableBalance > 0n ? `${formatStable(smartStableBalance)} ${draft.stablecoin} already available` : `Convert funded tBNB to ${draft.stablecoin}; keep ${formatNative(GAS_RESERVE)} tBNB for Gas`}</small></div><b className="checklist-state">{smartStableBalance > 0n ? 'Recorded' : `${draft.stablecoinSelection?.confidence ?? 0}% confidence`}</b></div>
          </div>
          <div className="approval-boundary"><KeyRound size={18} /><div><strong>Exact scope granted today</strong><span>The allocator chose {draft.stablecoin}, but it cannot grant itself broader access. The session is pinned to {shortAddress(selectedStable.router)}, the official CAKE router, CAKE/WBNB LP, MasterChef V2 PID 4, and flexible CAKE Pool methods. It cannot approve tokens, call arbitrary contracts, use leverage, or exceed daily caps.</span></div></div>
          {busy && <div className="operation-status"><LoaderCircle className="spin" size={16} /> {starting ? 'Starting the strategy...' : altanaStageCopy[altanaStage]}</div>}
          {!isPasskeySupported && <div className="inline-error"><AlertTriangle size={16} /> This browser does not expose WebAuthn passkeys.</div>}
          {(startError || walletError || altanaError) && <div className="inline-error"><AlertTriangle size={16} /> {startError || walletError || altanaError}</div>}
          <footer className="config-actions"><button className="secondary-button" disabled={busy} onClick={() => setStep(2)}>Back to strategy</button><button className="primary-button" disabled={!ready || busy} aria-busy={busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Fingerprint size={16} />} Normalize and start</button></footer>
        </>}
      </section>

      <aside className="strategy-preview">
        <div className="strategy-preview-head"><div><span>Generated strategy preview</span><strong>{selectedGoal.name}</strong></div><span className="network-pill"><i /> BNB Testnet</span></div>
        <div className="strategy-capital"><span>tBNB funding</span><strong>{draft.amount || '—'} <small>tBNB</small></strong><small>{draft.stablecoinSelection ? `≈ ${formatStable(managedAmount)} ${draft.stablecoin} after reserving ${formatNative(GAS_RESERVE)} tBNB Gas` : `AI will choose USDT or USDC after comparing live evidence`}</small></div>
        <StrategyBar plan={strategy} />
        <div className="preview-metrics"><div><span>Model yield</span><strong>{formatBps(strategy.modelYieldBps)}</strong></div><div><span>Risk score</span><strong>{strategy.riskScore}/10</strong></div><div><span>Review</span><strong>{strategy.reviewCadence}</strong></div></div>
        <div className="preview-live-route"><Route size={17} /><div><span>{draft.stablecoinSelection ? 'Live executor' : 'Stablecoin allocator'}</span><strong>{draft.stablecoinSelection ? executionActionLabel(executionPlan.action) : 'USDT vs USDC'}</strong><small>{draft.stablecoinSelection ? usableQuote ? `Quoted ${usableQuote.outputSymbol}` : executionPlan.action === 'HOLD' ? 'No swap required' : snapshotLoading ? 'Loading quote...' : 'Quote pending' : 'Yield · TVL · peg · route cost'}</small></div></div>
        <div className="preview-guardrail"><ShieldCheck size={17} /><span>Swap, CAKE/WBNB LP, Farm PID 4, and flexible CAKE Earn are executable on BSC Testnet. Each action remains bounded by the mandate and owner-approved allowance.</span></div>
      </aside>
    </div>
  </div>
}

function DecisionLog({ mandates, activationAttempts }: { mandates: Mandate[]; activationAttempts: ActivationAttempt[] }) {
  const decisions = mandates
    .flatMap((mandate) => mandate.decisions.map((decision) => ({ mandate, decision })))
    .sort((a, b) => b.decision.createdAt.localeCompare(a.decision.createdAt))
  const moduleReceipts = mandates
    .flatMap((mandate) => (mandate.moduleReceipts ?? []).map((moduleReceipt) => ({ mandate, moduleReceipt })))
    .sort((a, b) => b.moduleReceipt.createdAt.localeCompare(a.moduleReceipt.createdAt))
  const hasActivity = decisions.length > 0 || moduleReceipts.length > 0 || activationAttempts.length > 0

  return <div className="list-page">
    <div className="page-title-row"><div><span className="eyebrow">Execution evidence</span><h1>Activity</h1><p>Every Swap, LP, Farm, Earn, policy, and exit action keeps its own onchain receipt.</p></div></div>
    {!hasActivity ? <div className="simple-empty"><Activity size={26} /><h2>No activity yet</h2><p>Create a strategy to generate its first decision.</p></div> : <div className="decision-log">
      {[...activationAttempts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((attempt) => {
        const latestHash = attempt.moduleReceipts?.findLast((item) => item.transactionHash)?.transactionHash ?? attempt.grantTxHash ?? attempt.approvalTxHash ?? attempt.normalizationDecision?.transactionHash
        return <article key={attempt.id}>
          <div className="decision-icon hold">{attempt.phase === 'FAILED' ? <AlertTriangle size={17} /> : <LoaderCircle className="spin" size={17} />}</div>
          <div className="decision-copy"><div><strong>Strategy activation · {activationPhaseCopy[attempt.phase]}</strong><span>{attempt.name}</span></div><p>{attempt.error ?? 'Confirmed stages are journaled immediately. Closing or refreshing this page will not erase the visible evidence.'}</p><div className="decision-tags"><span>{attempt.stablecoin}</span><span>{attempt.fundingAmount} tBNB funded</span><span>{shortAddress(attempt.smartWallet)}</span>{attempt.recoveryDetected && <span>Existing positions preserved</span>}{attempt.normalizationDecision && <span>Startup conversion confirmed</span>}{attempt.grantTxHash && <span>Policy registered</span>}{attempt.moduleReceipts?.length ? <span>{completedPancakeModules(attempt.moduleReceipts).size}/4 modules</span> : null}</div></div>
          <div className="decision-evidence"><strong className={attempt.phase === 'FAILED' ? 'evidence-failed' : 'evidence-policy_only'}>{attempt.phase === 'FAILED' ? 'NEEDS ATTENTION' : 'IN PROGRESS'}</strong><span>{new Date(attempt.updatedAt).toLocaleString()}</span>{latestHash && <a href={txUrl(latestHash)} target="_blank" rel="noreferrer">Latest proof <ExternalLink size={12} /></a>}</div>
        </article>
      })}
      {moduleReceipts.map(({ mandate, moduleReceipt }) => {
        const Icon = moduleReceipt.module === 'SWAP' ? ArrowDownUp : moduleReceipt.module === 'LIQUIDITY' ? Waves : moduleReceipt.module === 'FARM' ? Layers3 : Leaf
        return <article key={moduleReceipt.id}>
          <div className={`decision-icon ${moduleReceipt.state === 'CONFIRMED' ? 'buy_native' : 'hold'}`}><Icon size={17} /></div>
          <div className="decision-copy"><div><strong>{moduleReceipt.module} · {moduleReceipt.operation.replaceAll('_', ' ')}</strong><span>{mandate.name}</span></div><p>{moduleReceipt.note}</p><div className="decision-tags"><span>{shortAddress(moduleReceipt.contract)}</span>{moduleReceipt.inputAmount && <span>{moduleReceipt.inputAmount} {moduleReceipt.inputAsset}</span>}{moduleReceipt.outputAmount && <span>Received {moduleReceipt.outputAmount} {moduleReceipt.outputAsset}</span>}</div></div>
          <div className="decision-evidence"><strong className={`evidence-${moduleReceipt.state.toLowerCase()}`}>{moduleReceipt.state}</strong><span>{new Date(moduleReceipt.createdAt).toLocaleString()}</span>{moduleReceipt.transactionHash && <a href={txUrl(moduleReceipt.transactionHash)} target="_blank" rel="noreferrer">Explorer <ExternalLink size={12} /></a>}</div>
        </article>
      })}
      {decisions.map(({ mandate, decision }) => {
        const activityName = decision.purpose === 'INITIAL_NORMALIZATION' ? 'Startup conversion' : decision.purpose === 'GAS_TOP_UP' ? 'Gas reserve top-up' : decision.expertAction?.replaceAll('_', ' ') ?? executionActionLabel(decision.action)
        return <article key={decision.id}><div className={`decision-icon ${decision.action.toLowerCase()}`}>{decision.action === 'HOLD' ? <Pause size={17} /> : decision.purpose === 'GAS_TOP_UP' ? <Fuel size={17} /> : <ArrowDownUp size={17} />}</div><div className="decision-copy"><div><strong>{activityName}</strong><span>{mandate.name}</span></div><p>{decision.rationale}</p><div className="decision-tags"><span>{decision.purpose.replaceAll('_', ' ')}</span>{decision.purpose === 'PORTFOLIO_REBALANCE' && <span>Reserve {allocationLabel(decision.currentStableBps)}</span>}{decision.gateStatus && <span>Gate: {decision.gateStatus.replaceAll('_', ' ')}</span>}{decision.reviewSource && <span>{decision.reviewSource}</span>}{decision.triggers?.map((trigger) => <span key={trigger}>{trigger.replaceAll('_', ' ')}</span>)}{decision.amountIn !== '0' && <span>{decision.amountIn} {decision.inputAsset}</span>}</div></div><div className="decision-evidence"><strong className={`evidence-${decision.state.toLowerCase()}`}>{decision.state.replace('_', ' ')}</strong><span>{new Date(decision.createdAt).toLocaleString()}</span>{decision.promptVersion && <span>{decision.promptVersion}</span>}{decision.transactionHash && <a href={txUrl(decision.transactionHash)} target="_blank" rel="noreferrer">Explorer <ExternalLink size={12} /></a>}</div></article>
      })}
    </div>}
  </div>
}

function Policies({ mandates, revokingId, exitingId, onPause, onRevoke, onExit, onCreate }: { mandates: Mandate[]; revokingId: string; exitingId: string; onPause: (id: string) => void; onRevoke: (id: string) => void; onExit: (id: string) => void; onCreate: () => void }) {
  return <div className="list-page"><div className="page-title-row"><div><span className="eyebrow">Owner control</span><h1>Guardrails</h1><p>AI strategy selection is flexible. Triggers, execution adapters, position limits, Gas reserve, expiry, and revocation remain deterministic.</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} /> New strategy</button></div>{mandates.length === 0 ? <div className="simple-empty"><ShieldCheck size={26} /><h2>No active mandates</h2><p>Create a strategy to register a scoped session on BNB Testnet.</p></div> : <><section className="trigger-policy-band"><header><BrainCircuit size={20} /><div><strong>When the manager wakes up</strong><span>One-minute monitoring scans these conditions. It does not trade by itself.</span></div><b>Prompt v3</b></header><div><span><RefreshCw size={15} /><strong>Schedule</strong><small>4h, 8h, or daily</small></span><span><Fuel size={15} /><strong>Gas reserve</strong><small>Refill below 0.0015 tBNB</small></span><span><BarChart3 size={15} /><strong>Allocation drift</strong><small>Outside approved band</small></span><span><Waves size={15} /><strong>LP risk</strong><small>Range edge or IL limit</small></span><span><TrendingUp size={15} /><strong>Yield change</strong><small>Net benefit improves 2.5%</small></span><span><AlertTriangle size={15} /><strong>Protocol risk</strong><small>Depeg or liquidity drop</small></span></div></section><div className="policy-list">{mandates.map((mandate) => { const strategy = planForMandate(mandate); return <article key={mandate.id}><div className="policy-head"><div className="policy-icon"><ShieldCheck size={20} /></div><div><strong>{mandate.name}</strong><span>{riskProfiles[mandate.riskProfile].name} · {mandate.managedAmount} tBNB funded → {mandate.stablecoin}</span></div><strong className={`status-${mandate.status.toLowerCase()}`}><i /> {mandate.status}</strong></div><div className="policy-details"><div><span>Review cadence</span><strong>{strategy.reviewCadence}</strong></div><div><span>AI-selected base</span><strong>{mandate.stablecoin}{mandate.stablecoinSelection ? ` · ${mandate.stablecoinSelection.confidence}%` : ''}</strong></div><div><span>Gas target</span><strong>0.003 tBNB</strong></div><div><span>Expiry</span><strong>{new Date(mandate.expiry * 1000).toLocaleDateString()}</strong></div></div><div className="policy-scope"><span><Check size={14} /> Bounded Swap routes</span><span><Check size={14} /> CAKE/WBNB LP only</span><span><Check size={14} /> Farm PID 4 only</span><span><Check size={14} /> Flexible CAKE Earn</span><span><Check size={14} /> No session approve</span><span><Check size={14} /> No leverage</span></div><footer><div>{mandate.grantTxHash && <a href={txUrl(mandate.grantTxHash)} target="_blank" rel="noreferrer">Grant transaction <ExternalLink size={12} /></a>}{mandate.exitTxHash && <a href={txUrl(mandate.exitTxHash)} target="_blank" rel="noreferrer">Exit transaction <ExternalLink size={12} /></a>}</div><div>{mandate.status !== 'Revoked' && <button className="secondary-button" onClick={() => onPause(mandate.id)}>{mandate.status === 'Paused' ? <Play size={15} /> : <Pause size={15} />}{mandate.status === 'Paused' ? 'Resume locally' : 'Pause locally'}</button>}<button className="secondary-button" disabled={exitingId === mandate.id} onClick={() => onExit(mandate.id)}>{exitingId === mandate.id ? <LoaderCircle className="spin" size={15} /> : <Vault size={15} />} {exitingId === mandate.id ? 'Returning assets' : 'Exit assets'}</button><button className="danger-button" disabled={mandate.status === 'Revoked' || revokingId === mandate.id} onClick={() => onRevoke(mandate.id)}>{revokingId === mandate.id ? <LoaderCircle className="spin" size={15} /> : <X size={15} />} {revokingId === mandate.id ? 'Revoking' : 'Revoke onchain'}</button></div></footer></article> })}</div></>}</div>
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [walletPickerOpen, setWalletPickerOpen] = useState(false)
  const [mandates, setMandates] = useState<Mandate[]>(loadMandates)
  const [activationAttempts, setActivationAttempts] = useState<ActivationAttempt[]>(loadActivationAttempts)
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')
  const [pancakePositions, setPancakePositions] = useState<PancakePositionSnapshot | null>(null)
  const [pancakeResearch, setPancakeResearch] = useState<PancakeResearchSnapshot | null>(null)
  const [pancakeMarket, setPancakeMarket] = useState<PancakeMarketSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [revokingId, setRevokingId] = useState('')
  const [exitingId, setExitingId] = useState('')
  const [checkingId, setCheckingId] = useState('')
  const [runtimeMandateIds, setRuntimeMandateIds] = useState<string[]>([])
  const runtimeSessions = useRef(new Map<string, Session>())
  const runtimeBusy = useRef(false)
  const mobileMenuButton = useRef<HTMLButtonElement>(null)
  const mobileCloseButton = useRef<HTMLButtonElement>(null)
  const walletButton = useRef<HTMLButtonElement>(null)
  const wallet = useInjectedWallet()
  const altana = useAltanaWallet()
  const activeMandate = mandates.find((mandate) => mandate.status !== 'Revoked') ?? null
  const activeStablecoin = activeMandate?.stablecoin ?? DEFAULT_STABLECOIN
  const portfolioAddress = altana.address ?? activeMandate?.smartWallet ?? null
  const openWalletPicker = useCallback(() => setWalletPickerOpen(true), [])
  const closeWalletPicker = useCallback(() => setWalletPickerOpen(false), [])

  useEffect(() => { localStorage.setItem(mandateStorageKey, JSON.stringify(mandates)) }, [mandates])
  useEffect(() => { localStorage.setItem(activationStorageKey, JSON.stringify(activationAttempts)) }, [activationAttempts])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [view])
  useEffect(() => { if (menuOpen) mobileCloseButton.current?.focus() }, [menuOpen])
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && menuOpen) closeMobileMenu() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  })

  function closeMobileMenu() {
    setMenuOpen(false)
    if (window.matchMedia('(max-width: 760px)').matches) window.requestAnimationFrame(() => mobileMenuButton.current?.focus())
  }

  const refreshSnapshot = useCallback(async (stablecoin: StablecoinSymbol = activeStablecoin) => {
    if (!portfolioAddress) { setSnapshot(null); return null }
    setSnapshotLoading(true)
    setSnapshotError('')
    try {
      const { readPortfolioSnapshot } = await import('./integrations/altana')
      const next = await readPortfolioSnapshot(portfolioAddress, stablecoin)
      setSnapshot(next)
      return next
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'Could not read the portfolio.')
      return null
    } finally {
      setSnapshotLoading(false)
    }
  }, [activeStablecoin, portfolioAddress])

  const refreshPancakePositions = useCallback(async (stablecoin: StablecoinSymbol = activeStablecoin) => {
    if (!portfolioAddress) { setPancakePositions(null); return null }
    try {
      const { readPancakePositions } = await import('./integrations/pancakeExecutor')
      const next = await readPancakePositions(portfolioAddress, stablecoin)
      setPancakePositions(next)
      return next
    } catch {
      setPancakePositions(null)
      return null
    }
  }, [activeStablecoin, portfolioAddress])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshSnapshot() }, 0)
    const interval = portfolioAddress ? window.setInterval(() => { void refreshSnapshot() }, 30_000) : null
    return () => { window.clearTimeout(initialRefresh); if (interval !== null) window.clearInterval(interval) }
  }, [portfolioAddress, refreshSnapshot])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshPancakePositions() }, 0)
    const interval = portfolioAddress ? window.setInterval(() => { void refreshPancakePositions() }, 30_000) : null
    return () => { window.clearTimeout(initialRefresh); if (interval !== null) window.clearInterval(interval) }
  }, [portfolioAddress, refreshPancakePositions])

  const refreshPancakeResearch = useCallback(async () => {
    try {
      const research = await fetchPancakeResearch()
      setPancakeResearch(research)
    } catch {
      // Research agents remain explicitly unavailable when the verified snapshot cannot be loaded.
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshPancakeResearch() }, 0)
    const interval = window.setInterval(() => { void refreshPancakeResearch() }, 5 * 60_000)
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(interval) }
  }, [refreshPancakeResearch])

  const refreshPancakeMarket = useCallback(async () => {
    try {
      const market = await fetchPancakeMarket()
      setPancakeMarket(market)
      return market
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshPancakeMarket() }, 0)
    const interval = window.setInterval(() => { void refreshPancakeMarket() }, 60_000)
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(interval) }
  }, [refreshPancakeMarket])

  const currentExecutionPlan = useMemo(() => {
    if (!activeMandate || !snapshot) return null
    const strategy = planForMandate(activeMandate)
    return buildPortfolioPlan({
      snapshot,
      managedAmount: safeParseStable(activeMandate.managedStableCap),
      goal: activeMandate.goal,
      risk: activeMandate.riskProfile,
      targetReserveBps: BigInt(allocationFor(strategy, 'reserve')),
    })
  }, [activeMandate, snapshot])

  const runPolicyCheck = useCallback(async (mandateId: string, silent = false, source: ReviewSource = 'MANUAL') => {
    const mandate = mandates.find((item) => item.id === mandateId)
    if (!mandate || mandate.status !== 'Active' || runtimeBusy.current) return
    runtimeBusy.current = true
    setCheckingId(mandateId)
    try {
      const [nextSnapshot, refreshedMarket] = await Promise.all([refreshSnapshot(mandate.stablecoin), refreshPancakeMarket()])
      if (!nextSnapshot) throw new Error('Portfolio data is unavailable.')
      const latestMarket = refreshedMarket ?? pancakeMarket
      const strategy = planForMandate(mandate)
      const plan = buildPortfolioPlan({
        snapshot: nextSnapshot,
        managedAmount: safeParseStable(mandate.managedStableCap),
        goal: mandate.goal,
        risk: mandate.riskProfile,
        targetReserveBps: BigInt(allocationFor(strategy, 'reserve')),
      })
      let liveQuote: PortfolioRebalanceQuote | null = null
      let executionCost: ExecutionCostEstimate | null = null
      try {
        const { estimatePortfolioExecutionCost, quotePortfolioPlan } = await import('./integrations/altana')
        liveQuote = await quotePortfolioPlan(plan)
        executionCost = await estimatePortfolioExecutionCost(plan, liveQuote)
      } catch {
        // The committee records missing cost evidence and the risk gate fails closed.
      }
      const committee = buildInvestmentCommittee({ strategy, executionPlan: plan, snapshot: nextSnapshot, executionCost, pancakeResearch, pancakeMarket: latestMarket })
      const review = await orchestrateWithAgentRuntime({
        source,
        mandate: {
          goal: mandate.goal,
          riskProfile: mandate.riskProfile,
          stablecoin: mandate.stablecoin,
          managedAmount: mandate.managedStableCap,
          horizonDays: mandate.duration,
          liquidityNeed: mandate.liquidityNeed ?? 'weekly',
          expiry: mandate.expiry,
        },
        strategy,
        executionPlan: plan,
        lastReviewAt: mandate.decisions[0]?.createdAt,
        lastExecutionAt: mandate.decisions.find((decision) => decision.gateStatus === 'AUTO_EXECUTE')?.createdAt,
        committee,
      }, nextSnapshot)
      if (!review.reviewNeeded) return
      if (source === 'MONITOR' && review.gate.status === 'DEFERRED') return
      let result: Pick<AltanaPortfolioProof, 'quote' | 'execution' | 'executionError' | 'outputReceived'> | undefined
      if (review.gate.status === 'AUTO_EXECUTE' && plan.action !== 'HOLD') {
        const session = runtimeSessions.current.get(mandateId)
        if (!session) throw new Error('This browser no longer holds the scoped runtime key. Create a replacement policy to resume execution.')
        const { executePortfolioPlanWithSession } = await import('./integrations/altana')
        result = await executePortfolioPlanWithSession(session, plan, liveQuote ?? undefined)
      }
      const decision = buildDecision(plan, result, review)
      setMandates((current) => current.map((item) => item.id === mandateId ? { ...item, decisions: [decision, ...item.decisions] } : item))
      await refreshSnapshot(mandate.stablecoin)
      if (!silent) {
        if (result?.execution?.status === 'CONFIRMED') setNotice('Expert review passed the risk gate and the bounded PancakeSwap route confirmed on BNB Testnet.')
        else if (review.gate.status === 'APPROVAL_REQUIRED') setNotice('Expert review complete. The proposed action is waiting for explicit owner approval.')
        else if (review.gate.status === 'BLOCKED') setNotice('Expert review complete. The action is blocked until its typed execution adapter is live.')
        else if (review.gate.status === 'DEFERRED') setNotice('Expert review complete. The action was deferred by the mandate cooldown.')
        else setNotice('Expert review complete. No automatic action is authorised.')
      }
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : 'Strategy review failed.')
    } finally {
      runtimeBusy.current = false
      setCheckingId('')
    }
  }, [mandates, pancakeMarket, pancakeResearch, refreshPancakeMarket, refreshSnapshot])

  useEffect(() => {
    if (!activeMandate || activeMandate.status !== 'Active' || !runtimeMandateIds.includes(activeMandate.id)) return
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void runPolicyCheck(activeMandate.id, true, 'MONITOR') }, 60_000)
    return () => window.clearInterval(interval)
  }, [activeMandate, runPolicyCheck, runtimeMandateIds])

  async function fundAltanaWallet(draft: MandateDraft) {
    if (!wallet.provider || !wallet.account) return
    const target = safeParseNative(draft.amount)
    const current = altana.balanceWei ?? 0n
    const missing = target > current ? target - current : 0n
    if (missing <= 0n) {
      setNotice('The existing tBNB in this Passkey account already meets the funding target.')
      return
    }
    await altana.fund(wallet.provider, wallet.account, missing)
    await wallet.refresh()
    await refreshSnapshot(draft.stablecoin)
    setNotice(`${formatNative(missing)} tBNB deposited into your owner-controlled Passkey account.`)
  }

  async function startMandate(draft: MandateDraft) {
    const smartWallet = altana.address
    if (!smartWallet) throw new Error('Create or recover the Passkey smart account before activation.')
    if (!draft.stablecoinSelection || draft.stablecoinSelection.stablecoin !== draft.stablecoin) {
      throw new Error('Generate the strategy again so the stablecoin allocation agent can select the base asset.')
    }
    const attemptId = crypto.randomUUID()
    const goalName = goalOptions.find((goal) => goal.id === draft.goal)?.name ?? 'Managed portfolio'
    const now = new Date().toISOString()
    const updateAttempt = (patch: Partial<ActivationAttempt>) => {
      setActivationAttempts((current) => current.map((item) => item.id === attemptId ? {
        ...item,
        ...patch,
        updatedAt: new Date().toISOString(),
      } : item))
    }
    setActivationAttempts((current) => [{
      id: attemptId,
      name: `${goalName} strategy`,
      createdAt: now,
      updatedAt: now,
      stablecoin: draft.stablecoin,
      smartWallet,
      fundingAmount: draft.amount,
      phase: 'PREPARING',
    }, ...current])
    try {
    const [fundingSnapshot, refreshedMarket] = await Promise.all([refreshSnapshot(draft.stablecoin), refreshPancakeMarket()])
    if (!fundingSnapshot) throw new Error('Portfolio data is unavailable.')
    const requestedFunding = safeParseNative(draft.amount)
    const alreadyNormalized = fundingSnapshot.stableBalance > 0n && fundingSnapshot.nativeBalance >= GAS_RESERVE
    if (fundingSnapshot.nativeBalance < requestedFunding && !alreadyNormalized) {
      throw new Error(`Deposit at least ${draft.amount} tBNB before activating the strategy.`)
    }
    let normalization: AltanaNormalizationProof | null = null
    const nativeForConversion = fundingSnapshot.nativeBalance > GAS_RESERVE
      ? fundingSnapshot.nativeBalance - GAS_RESERVE
      : 0n
    if (nativeForConversion > 0n) {
      updateAttempt({ phase: 'NORMALIZING' })
      normalization = await altana.normalizeFunding(draft.stablecoin, nativeForConversion)
    }
    const normalizationDecision = normalization ? buildNormalizationDecision(normalization, draft.stablecoinSelection) : null
    if (normalizationDecision) updateAttempt({ normalizationDecision, phase: 'REVIEWING' })
    else updateAttempt({ phase: 'REVIEWING' })
    const latestSnapshot = await refreshSnapshot(draft.stablecoin)
    if (!latestSnapshot || latestSnapshot.stableBalance <= 0n) {
      throw new Error(`The owner startup conversion did not produce ${draft.stablecoin}. Review the wallet transaction before retrying.`)
    }
    const [{ hasExistingPancakeExposure }, existingPositions] = await Promise.all([
      import('./integrations/pancakeExecutor'),
      refreshPancakePositions(draft.stablecoin),
    ])
    const preserveExistingPositions = existingPositions ? hasExistingPancakeExposure(existingPositions) : false
    if (preserveExistingPositions) updateAttempt({ recoveryDetected: true, phase: 'REVIEWING' })
    if (latestSnapshot.nativeBalance < GAS_LOW_WATERMARK) {
      throw new Error('Startup conversion left too little tBNB for safe execution. Add tBNB before retrying.')
    }
    const managedAmount = latestSnapshot.stableBalance
    const managedStableCap = formatUnits(managedAmount, 18)
    const fundedNativeAmount = normalization ? normalization.amountIn + GAS_RESERVE : requestedFunding
    const latestMarket = refreshedMarket ?? pancakeMarket
    const strategy = buildStrategyPlan({ goal: draft.goal, risk: draft.risk, liquidityNeed: draft.liquidityNeed, horizonDays: draft.duration })
    const executionPlan = buildPortfolioPlan({
      snapshot: latestSnapshot,
      managedAmount,
      goal: draft.goal,
      risk: draft.risk,
      targetReserveBps: BigInt(allocationFor(strategy, 'reserve')),
    })
    let executionCost: ExecutionCostEstimate | null = null
    try {
      const { estimatePortfolioExecutionCost, quotePortfolioPlan } = await import('./integrations/altana')
      const quote = await quotePortfolioPlan(executionPlan)
      executionCost = await estimatePortfolioExecutionCost(executionPlan, quote)
    } catch {
      // Activation can still register the mandate, but execution remains deferred.
    }
    const committee = buildInvestmentCommittee({ strategy, executionPlan, snapshot: latestSnapshot, executionCost, pancakeResearch, pancakeMarket: latestMarket })
    const review = await orchestrateWithAgentRuntime({
      source: 'ACTIVATION',
      mandate: {
        goal: draft.goal,
        riskProfile: draft.risk,
        stablecoin: draft.stablecoin,
        managedAmount: managedStableCap,
        horizonDays: draft.duration,
        liquidityNeed: draft.liquidityNeed,
        expiry: Math.floor(Date.now() / 1_000) + draft.duration * 24 * 60 * 60,
      },
      strategy,
      executionPlan,
      committee,
    }, latestSnapshot)
    updateAttempt({ phase: 'APPROVING' })
    const recordActivationProgress = (progress: PancakeActivationProgress) => {
      if (progress.phase === 'APPROVED') updateAttempt({ phase: 'GRANTING', approvalTxHash: progress.transactionHash })
      else if (progress.phase === 'GRANTED') updateAttempt({ phase: 'DEPLOYING', grantTxHash: progress.transactionHash })
      else updateAttempt({ phase: 'DEPLOYING', moduleReceipts: progress.receipts })
    }
    const proof = await altana.activateDeFiPortfolio(
      draft.duration,
      strategy,
      latestSnapshot,
      executionPlan,
      review.gate.status === 'AUTO_EXECUTE',
      recordActivationProgress,
      preserveExistingPositions,
    )
    const id = crypto.randomUUID()
    runtimeSessions.current.set(id, proof.session)
    setRuntimeMandateIds((current) => [...current, id])
    const decision = buildDeploymentDecision(executionPlan, proof, review)
    const strategyAllocations = Object.fromEntries(strategy.sleeves.map((sleeve) => [sleeve.id, sleeve.allocationBps])) as Record<StrategySleeveId, number>
    const mandate: Mandate = {
      id,
      name: `${goalName} strategy`,
      goal: draft.goal,
      riskProfile: draft.risk,
      stablecoin: draft.stablecoin,
      stablecoinSelection: draft.stablecoinSelection,
      managedAmount: formatEther(fundedNativeAmount),
      managedStableCap,
      duration: draft.duration,
      liquidityNeed: draft.liquidityNeed,
      strategyAllocations,
      modelYieldBps: strategy.modelYieldBps,
      strategyRiskScore: strategy.riskScore,
      status: 'Active',
      createdAt: new Date().toISOString(),
      chainId: 97,
      smartWallet: proof.session.walletAddress,
      sessionPublicKey: proof.session.publicKey,
      expiry: proof.session.expiry,
      targetStableBps: Number(executionPlan.targetStableBps),
      driftBandBps: Number(executionPlan.driftBandBps),
      maxSlippageBps: Number(executionPlan.maxSlippageBps),
      dailyNativeCap: formatNative(executionPlan.dailyNativeCap),
      dailyStableCap: formatStable(executionPlan.dailyStableCap),
      grantTxHash: proof.grant.transactionHash,
      moduleReceipts: proof.receipts,
      decisions: normalizationDecision ? [decision, normalizationDecision] : [decision],
    }
    setPancakePositions(proof.positions)
    setMandates((current) => [mandate, ...current])
    setActivationAttempts((current) => current.filter((item) => item.id !== attemptId))
    await refreshSnapshot(draft.stablecoin)
    setView('overview')
    const confirmedModules = completedPancakeModules(proof.receipts)
    setNotice(proof.recoveredExistingPositions
      ? 'Existing PancakeSwap positions were preserved and attached to a replacement revocable AI policy. No portfolio allocation was repeated.'
      : confirmedModules.size === 4
      ? `The allocation agent selected ${draft.stablecoin}; Swap, LP, Farm, and Earn all confirmed on BSC Testnet.`
      : `The strategy is active with ${confirmedModules.size}/4 modules confirmed. Review Activity before retrying any incomplete adapter.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Strategy activation did not complete.'
      updateAttempt({ phase: 'FAILED', error: message })
      setView('decisions')
      setNotice(message)
      throw error
    }
  }

  async function revokeMandate(id: string) {
    const mandate = mandates.find((item) => item.id === id)
    if (!mandate) return
    setRevokingId(id)
    try {
      const result = await altana.revoke(mandate.sessionPublicKey)
      if (result.status === 'FAILED') throw new Error('Altana reported a failed revoke transaction.')
      runtimeSessions.current.delete(id)
      setRuntimeMandateIds((current) => current.filter((item) => item !== id))
      setMandates((current) => current.map((item) => item.id === id ? { ...item, status: 'Revoked', revokeTxHash: result.transactionHash } : item))
      setNotice('Policy revoked onchain. The runtime can no longer act on this wallet.')
    } finally {
      setRevokingId('')
    }
  }

  async function exitMandateAssets(id: string) {
    const mandate = mandates.find((item) => item.id === id)
    if (!mandate) return
    if (!wallet.account || !wallet.isTargetNetwork) {
      setNotice('Connect the owner destination wallet on BNB Testnet before exiting assets.')
      return
    }
    if (altana.address?.toLowerCase() !== mandate.smartWallet.toLowerCase()) {
      setNotice('Recover the Passkey smart account that owns this mandate before exiting assets.')
      return
    }
    if (!window.confirm(`Revoke AI access, withdraw Earn and Farm, remove LP, then return liquid assets to ${shortAddress(wallet.account)}?`)) return
    setExitingId(id)
    try {
      let revokeTxHash = mandate.revokeTxHash
      if (mandate.status !== 'Revoked') {
        const revoke = await altana.revoke(mandate.sessionPublicKey)
        if (revoke.status === 'FAILED') throw new Error('The onchain session revoke failed, so assets were not moved.')
        revokeTxHash = revoke.transactionHash
        runtimeSessions.current.delete(id)
        setRuntimeMandateIds((current) => current.filter((item) => item !== id))
      }
      const result = await altana.exitAssets(mandate.stablecoin, wallet.account)
      if (result.transaction.status === 'FAILED') throw new Error('The owner-authorized exit transaction failed.')
      setMandates((current) => current.map((item) => item.id === id ? {
        ...item,
        status: 'Revoked',
        revokeTxHash,
        exitTxHash: result.transaction.transactionHash,
        moduleReceipts: [...result.receipts, ...(item.moduleReceipts ?? [])],
      } : item))
      await Promise.all([wallet.refresh(), refreshSnapshot(mandate.stablecoin), refreshPancakePositions(mandate.stablecoin)])
      setNotice(`Assets returned to ${shortAddress(wallet.account)}. The revoked AI session cannot act again.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not return assets to the owner wallet.')
    } finally {
      setExitingId('')
    }
  }

  function togglePause(id: string) {
    setMandates((current) => current.map((item) => item.id === id && item.status !== 'Revoked' ? { ...item, status: item.status === 'Paused' ? 'Active' : 'Paused' } : item))
  }

  async function selectInjectedWallet(walletId: string) {
    const connected = await wallet.connect(walletId)
    if (connected) closeWalletPicker()
  }

  return <div className="app-shell">
    <header className="app-header"><div className="app-header-inner">
      <button className="header-brand" onClick={() => setView('overview')}><span className="brand-mark"><BarChart3 size={19} /></span><span><strong>MandateFi</strong><small>AI DeFi Manager</small></span></button>
      <nav className="top-navigation">{navItems.map((item) => { const Icon = item.icon; const activityCount = mandates.reduce((sum, mandate) => sum + mandate.decisions.length + (mandate.moduleReceipts?.length ?? 0), 0) + activationAttempts.length; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon size={16} /><span>{item.label}</span>{item.id === 'decisions' && activityCount > 0 && <b>{activityCount}</b>}</button> })}</nav>
      <div className="header-actions"><span className="header-network"><i className={wallet.isTargetNetwork ? 'online' : ''} /> BNB Testnet</span><button ref={walletButton} className={wallet.isConnected ? 'wallet-button connected' : 'wallet-button'} disabled={wallet.status === 'connecting'} onClick={openWalletPicker} title={wallet.selectedWallet?.name ?? 'Connect wallet'}><Wallet size={17} /><span className="wallet-button-copy">{wallet.status === 'connecting' ? <strong>Connecting...</strong> : wallet.account ? <><strong>{wallet.selectedWallet?.name ?? 'Wallet'} · {shortAddress(wallet.account)}</strong><small>{!wallet.isTargetNetwork ? 'Switch to BNB Testnet' : wallet.balanceStatus === 'loading' ? 'Reading balance...' : wallet.balanceStatus === 'error' ? 'Balance unavailable' : `${wallet.balance ?? '0'} tBNB`}</small></> : <strong>Connect wallet</strong>}</span></button><button ref={mobileMenuButton} className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button></div>
    </div>
    <nav className={`mobile-navigation ${menuOpen ? 'open' : ''}`}><div><strong>Navigate</strong><button ref={mobileCloseButton} className="icon-button" onClick={closeMobileMenu} aria-label="Close menu"><X size={18} /></button></div>{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); closeMobileMenu() }}><Icon size={18} /><span>{item.label}</span></button> })}<aside><ShieldCheck size={17} /><span><strong>{activeMandate ? activeMandate.name : 'Owner-controlled by default'}</strong><small>{activeMandate ? `${activeMandate.managedAmount} tBNB → ${activeMandate.stablecoin} · ${riskProfiles[activeMandate.riskProfile].name}` : 'Passkey admin and revocable scope'}</small></span></aside></nav>
    </header>
    <button className={`navigation-scrim ${menuOpen ? 'visible' : ''}`} onClick={closeMobileMenu} aria-label="Close navigation" />
    <main className="main-area" inert={menuOpen ? true : undefined} aria-hidden={menuOpen ? true : undefined}><div className="page-content">
      {view === 'overview' && <PortfolioOverview mandate={activeMandate} snapshot={snapshot} positions={pancakePositions} executionPlan={currentExecutionPlan} pancakeResearch={pancakeResearch} pancakeMarket={pancakeMarket} loading={snapshotLoading} runtimeAvailable={Boolean(activeMandate && runtimeMandateIds.includes(activeMandate.id))} checking={checkingId === activeMandate?.id} onCreate={() => setView('create')} onCheck={() => { if (activeMandate) void runPolicyCheck(activeMandate.id) }} onOpenPolicies={() => setView('policies')} />}
      {view === 'create' && <MandateWizard snapshotLoading={snapshotLoading} account={wallet.account} isTargetNetwork={wallet.isTargetNetwork} walletError={wallet.error} walletName={wallet.selectedWallet?.name ?? 'Browser wallet'} walletBalance={wallet.balance} walletBalanceStatus={wallet.balanceStatus} altanaAddress={altana.address} altanaBalance={altana.balance} altanaBalanceWei={altana.balanceWei} altanaStage={altana.stage} altanaError={altana.error} pancakeResearch={pancakeResearch} pancakeMarket={pancakeMarket} isPasskeySupported={altana.isPasskeySupported} onConnect={openWalletPicker} onSwitchNetwork={() => void wallet.switchNetwork()} onCreateAltana={() => void altana.create().catch(() => undefined)} onRecoverAltana={() => void altana.recover().catch(() => undefined)} onFundAltana={fundAltanaWallet} onStart={startMandate} onCancel={() => setView('overview')} />}
      {view === 'decisions' && <DecisionLog mandates={mandates} activationAttempts={activationAttempts} />}
      {view === 'policies' && <Policies mandates={mandates} revokingId={revokingId} exitingId={exitingId} onPause={togglePause} onRevoke={(id) => void revokeMandate(id)} onExit={(id) => void exitMandateAssets(id)} onCreate={() => setView('create')} />}
      {view === 'about' && <AboutPage onCreate={() => setView('create')} />}
    </div></main>
    <WalletPicker open={walletPickerOpen} wallets={wallet.wallets} selectedWalletId={wallet.selectedWalletId} connected={wallet.isConnected} account={wallet.account} balance={wallet.balance} balanceStatus={wallet.balanceStatus} targetNetwork={wallet.isTargetNetwork} status={wallet.status} error={wallet.error} onClose={closeWalletPicker} onSelect={selectInjectedWallet} onSwitchNetwork={wallet.switchNetwork} onRefresh={wallet.refresh} onClearError={wallet.clearError} />
    {snapshotError && <div className="toast error-toast"><AlertTriangle size={17} /><span>{snapshotError}</span><button onClick={() => void refreshSnapshot()} aria-label="Retry portfolio data"><RefreshCw size={15} /></button></div>}
    {notice && <div className="toast"><CircleCheck size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {(wallet.error || altana.error) && view !== 'create' && <div className="toast error-toast"><AlertTriangle size={17} /><span>{wallet.error || altana.error}</span><button onClick={() => { wallet.clearError(); altana.clearError() }} aria-label="Dismiss error"><X size={15} /></button></div>}
  </div>
}

export default App
