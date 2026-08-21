import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownUp, ArrowRight, BarChart3, Bot, BrainCircuit,
  BookOpen, Check, ChevronRight, CircleCheck,
  ExternalLink, Fingerprint, Fuel, Gauge, KeyRound, Layers3, LayoutDashboard,
  Leaf, LoaderCircle, Menu, Pause, Play, Plus, RefreshCw, Route, Search,
  Settings2, ShieldCheck, TrendingUp, Vault, Wallet, Waves, Workflow, X,
} from 'lucide-react'
import { parseEther } from 'viem'
import type { Session } from '@altananetwork/sdk'
import {
  buildPortfolioPlan, formatNative, formatStable, GAS_RESERVE, goalOptions,
  riskProfiles, type InvestmentGoal, type PortfolioPlan, type PortfolioSnapshot,
  type RiskProfileId,
} from './domain/portfolio'
import {
  allocationFor, buildStrategyPlan, formatBps, type ExecutionCoverage, type LiquidityNeed,
  type StrategyPlan, type StrategySleeveId,
} from './domain/strategy'
import { orchestrateStrategyReview, type StrategyReview } from './domain/strategyOrchestrator'
import {
  buildInvestmentCommittee,
  type ExecutionCostEstimate,
  type InvestmentCommittee,
} from './domain/investmentCommittee'
import type { ReviewSource } from './domain/triggerEngine'
import { useAltanaWallet, type AltanaStage } from './hooks/useAltanaWallet'
import { useInjectedWallet } from './hooks/useInjectedWallet'
import { BSC_TESTNET_EXPLORER_URL } from './lib/chains'
import { shortAddress } from './lib/wallet'
import type { AltanaPortfolioProof, PortfolioRebalanceQuote } from './integrations/altana'
import {
  fetchPancakeResearch,
  type PancakeResearchSnapshot,
} from './integrations/pancakeResearch'
import type { DecisionRecord, Mandate } from './types'
import './App.css'

type View = 'overview' | 'create' | 'decisions' | 'policies' | 'about'
type MandateDraft = {
  amount: string
  duration: number
  goal: InvestmentGoal
  risk: RiskProfileId
  liquidityNeed: LiquidityNeed
}

const mandateStorageKey = 'mandatefi.portfolio-mandates.v3'

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
  granting: 'Registering the scoped policy onchain...',
  executing: 'Executing the approved PancakeSwap route...',
  revoking: 'Revoking the policy onchain...',
  error: 'Action required',
}

const liquidityOptions: Array<{ id: LiquidityNeed; name: string; description: string }> = [
  { id: 'anytime', name: 'Anytime', description: 'Keep more capital liquid for withdrawals.' },
  { id: 'weekly', name: 'Weekly', description: 'Balance liquidity with active yield positions.' },
  { id: 'term', name: 'At term', description: 'Allow more capital to work in LP and earn positions.' },
]

const toolNames = {
  'smart-router': 'PancakeSwap Swap',
  'infinity-liquidity': 'Infinity Liquidity',
  'universal-farms': 'Universal Farms',
  'cake-earn': 'CAKE Earn',
} as const

function loadMandates(): Mandate[] {
  try {
    const current = localStorage.getItem(mandateStorageKey)
    const legacy = localStorage.getItem('mandatefi.portfolio-mandates.v2')
    const parsed = JSON.parse(current ?? legacy ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Mandate => Boolean(
      item && typeof item === 'object' && typeof item.name === 'string' &&
      typeof item.smartWallet === 'string' && Array.isArray(item.decisions),
    ))
  } catch {
    return []
  }
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

function executionActionLabel(action: PortfolioPlan['action']) {
  if (action === 'BUY_STABLE') return 'Build liquid reserve'
  if (action === 'BUY_NATIVE') return 'Increase market exposure'
  return 'No swap required'
}

function coverageLabel(coverage: ExecutionCoverage) {
  if (coverage === 'LIVE') return 'Live executor'
  if (coverage === 'APPROVAL_REQUIRED') return 'Owner approval'
  return 'Adapter planned'
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
    committee: review?.committee,
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
  const preview = buildStrategyPlan({ goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly', horizonDays: 30 })
  return <div className="home-page">
    <section className="home-hero">
      <div className="hero-copy">
        <span className="product-kicker"><BrainCircuit size={16} /> Five-agent investment committee</span>
        <h1>Put your DeFi portfolio<br />on a clear strategy.</h1>
        <p>Choose an outcome and risk level. MandateFi builds a PancakeSwap portfolio across spot, liquidity, farms, and earn. Completed adapters execute inside your mandate; every other action requires approval.</p>
        <div className="hero-actions"><button className="primary-button hero-button" onClick={onCreate}>Build my strategy <ArrowRight size={18} /></button><span><ShieldCheck size={16} /> No custody. No leverage. Revoke anytime.</span></div>
      </div>
      <div className="hero-workspace" aria-label="Balanced AI strategy preview">
        <header><div><span>AI strategy preview</span><strong>Balanced growth</strong></div><span className="network-pill"><i /> BNB Chain</span></header>
        <div className="hero-total"><span>Capital assigned</span><strong>$10,000</strong><small>30-day mandate · weekly liquidity</small></div>
        <StrategyBar plan={preview} />
        <div className="hero-plan-row">
          <span><Route size={17} /><b>Swap</b><small>Build basket</small></span><ChevronRight size={15} />
          <span><Waves size={17} /><b>Liquidity</b><small>Earn fees</small></span><ChevronRight size={15} />
          <span><Layers3 size={17} /><b>Farm</b><small>Add rewards</small></span><ChevronRight size={15} />
          <span><RefreshCw size={17} /><b>Compound</b><small>Recycle yield</small></span>
        </div>
        <footer><span><Bot size={16} /> Specialists monitor markets and costs continuously</span><strong>Risk {preview.riskScore}/10</strong></footer>
      </div>
    </section>
    <section className="product-proof" aria-label="Product capabilities">
      <div><BrainCircuit size={19} /><span><strong>Run an investment committee</strong><small>Market, LP, Farm, Earn, and cost specialists report independently.</small></span></div>
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
  { name: 'Swap', status: 'Live', detail: 'Auto-execute', icon: ArrowDownUp, tone: 'live' },
  { name: 'Liquidity', status: 'Approval', detail: 'Owner confirms', icon: Waves, tone: 'approval' },
  { name: 'Farms', status: 'Next', detail: 'Adapter planned', icon: Layers3, tone: 'planned' },
  { name: 'Earn', status: 'Next', detail: 'Adapter planned', icon: Leaf, tone: 'planned' },
] as const

const aboutFaqs = [
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
        <p>One mandate. Five specialists. No custody.</p>
        <button className="primary-button" onClick={onCreate}>Build a strategy <ArrowRight size={16} /></button>
      </div>
    </header>

    <section className="about-section about-workflow">
      <div className="about-section-heading"><span className="eyebrow">How it works</span><h2>Four steps</h2></div>
      <div className="about-flow" aria-label="MandateFi operating workflow">
        <article><span><Settings2 size={20} /></span><div><strong>Set mandate</strong><p>Goal · risk · limits</p></div></article>
        <ChevronRight size={18} />
        <article><span><BrainCircuit size={20} /></span><div><strong>AI analyzes</strong><p>Five specialists</p></div></article>
        <ChevronRight size={18} />
        <article><span><ShieldCheck size={20} /></span><div><strong>Policy checks</strong><p>Allow · hold · block</p></div></article>
        <ChevronRight size={18} />
        <article><span><Route size={20} /></span><div><strong>PancakeSwap</strong><p>Execute · record</p></div></article>
      </div>
    </section>

    <section className="about-section about-team">
      <div className="about-section-heading"><span className="eyebrow">AI team</span><h2>Five signals.<br />One decision.</h2></div>
      <div className="agent-decision-map">
        <div className="about-agent-grid">{aboutAgents.map((agent) => { const Icon = agent.icon; return <article key={agent.name}><Icon size={20} /><strong>{agent.name}</strong><span>{agent.signal}</span></article> })}</div>
        <div className="agent-merge" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <div className="manager-decision"><BrainCircuit size={24} /><span><small>Portfolio manager</small><strong>Hold · Rebalance · Ask owner</strong></span></div>
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

function PortfolioOverview({ mandate, snapshot, executionPlan, pancakeResearch, loading, runtimeAvailable, checking, onCreate, onCheck, onOpenPolicies }: {
  mandate: Mandate | null
  snapshot: PortfolioSnapshot | null
  executionPlan: PortfolioPlan | null
  pancakeResearch: PancakeResearchSnapshot | null
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
  const managedValue = executionPlan?.managedValue ?? safeParseNative(mandate.managedAmount)
  const recommendationTitle = latest?.expertAction ? latest.expertAction.replaceAll('_', ' ') : executionPlan ? executionActionLabel(executionPlan.action) : 'Reading portfolio'
  const gateStatus = latest?.gateStatus ?? (executionPlan?.action === 'HOLD' ? 'HOLD' : 'PENDING REVIEW')
  const committee: InvestmentCommittee | null = executionPlan
    ? buildInvestmentCommittee({ strategy, executionPlan, snapshot, pancakeResearch })
    : latest?.committee ?? null
  return <div className="dashboard-page">
    <div className="page-title-row"><div><span className="eyebrow">Managed strategy</span><h1>{mandate.name}</h1><p>{strategy.summary} Capital remains in the passkey smart wallet.</p></div><div className="title-actions"><button className="secondary-button" onClick={onOpenPolicies}><Settings2 size={16} /> Guardrails</button><button className="primary-button" disabled={checking || mandate.status !== 'Active'} onClick={onCheck}>{checking ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} Run live review</button></div></div>
    <section className="portfolio-hero-panel"><div className="portfolio-value-block"><span>Capital under mandate</span><strong>{loading ? 'Refreshing...' : `${formatNative(managedValue)} tBNB`}</strong><small>BNB Testnet portfolio proof</small></div><Metric label="Model yield" value={`${formatBps(strategy.modelYieldBps)} APY`} detail="Scenario estimate, not a live quote" /><Metric label="Strategy risk" value={`${strategy.riskScore}/10`} detail={`${riskProfiles[mandate.riskProfile].name} mandate`} /><Metric label="Next review" value={strategy.reviewCadence} detail={runtimeAvailable ? 'Local executor online' : 'Owner approval required'} /></section>
    <div className="dashboard-layout">
      <section className="workspace-panel allocation-panel"><header className="panel-header"><div><span>AI portfolio construction</span><h2>Where the capital works</h2></div><span className="status-chip active"><i /> Active mandate</span></header><StrategyBar plan={strategy} /><div className="sleeve-grid">{strategy.sleeves.map((sleeve) => <article key={sleeve.id}><div className={`sleeve-icon sleeve-${sleeve.id}`}>{sleeve.id === 'reserve' ? <Vault size={18} /> : sleeve.id === 'market' ? <TrendingUp size={18} /> : sleeve.id === 'liquidity' ? <Waves size={18} /> : <Leaf size={18} />}</div><span>{sleeve.name}</span><strong>{formatBps(sleeve.allocationBps)}</strong><p>{sleeve.purpose}</p><small>{toolNames[sleeve.tool]}</small></article>)}</div></section>
      <aside className="workspace-panel ai-panel"><header className="panel-header"><div><span>Latest expert review</span><h2>{recommendationTitle}</h2></div><BrainCircuit size={23} /></header>{(latest || executionPlan) && <><p>{latest?.rationale ?? executionPlan?.rationale}</p>{latest?.triggers?.length ? <div className="trigger-chips" aria-label="Active review triggers">{latest.triggers.map((trigger) => <span key={trigger}>{trigger.replaceAll('_', ' ')}</span>)}</div> : <div className="trigger-chips"><span>NO ACTIVE EVENT RISK</span></div>}<div className="ai-signals"><div><span>Portfolio data</span><strong>{snapshot ? 'Live snapshot' : 'Waiting'}</strong></div><div><span>Review source</span><strong>{latest?.reviewSource ?? 'Awaiting review'}</strong></div><div><span>Confidence</span><strong>{latest?.confidence !== undefined ? `${latest.confidence}%` : '—'}</strong></div><div><span>Risk gate</span><strong>{gateStatus.replaceAll('_', ' ')}</strong></div></div><div className={`ai-decision ${latest?.gateStatus === 'AUTO_EXECUTE' ? 'trade' : 'hold'}`}>{latest?.gateStatus === 'AUTO_EXECUTE' ? <ArrowDownUp size={17} /> : <CircleCheck size={17} />}<span>{latest?.gateStatus === 'AUTO_EXECUTE' && executionPlan ? `${executionPlan.inputAsset} to ${executionPlan.outputAsset} adapter authorised` : latest?.gateStatus === 'APPROVAL_REQUIRED' ? 'Waiting for explicit owner approval' : latest?.gateStatus === 'BLOCKED' ? 'Recommendation blocked until its adapter is live' : latest?.gateStatus === 'DEFERRED' ? 'Execution delayed by the cooldown policy' : 'No automatic action authorised'}</span></div></>}</aside>
      {committee && <section className="workspace-panel committee-panel"><header className="panel-header"><div><span>Investment committee</span><h2>Five specialists, one bounded decision</h2></div><span className="coverage-note">{committee.readyAgents}/5 current · Mainnet research</span></header><div className="committee-summary"><div><span>Committee view</span><strong>{committee.summary}</strong></div><div><span>Execution cost</span><strong>{committee.executionCostBps === null ? 'Run live review' : formatBps(committee.executionCostBps)}</strong></div><div><span>Cost ceiling</span><strong>{formatBps(strategy.guardrails.maximumExecutionCostBps)}</strong></div><div><span>Best observed signal</span><strong>{committee.grossBenefitBps === null ? 'Not measurable' : formatBps(committee.grossBenefitBps - committee.riskCostBps)}</strong><small>24h annualized snapshot, not a forecast</small></div></div><div className="committee-grid">{committee.reports.map((report) => <article key={report.agentId}><div className="committee-agent-icon">{report.agentId === 'market' ? <BarChart3 size={17} /> : report.agentId === 'liquidity' ? <Waves size={17} /> : report.agentId === 'farms' ? <Layers3 size={17} /> : report.agentId === 'earn' ? <Leaf size={17} /> : <Fuel size={17} />}</div><div className="committee-agent-head"><strong>{report.name}</strong><span className={`agent-status agent-${report.status.toLowerCase()}`}>{report.status}</span></div><p>{report.headline}</p>{report.findings[0] && <span className="committee-evidence">{report.findings[0]}</span>}<footer><small>Every {report.cadenceMinutes < 60 ? `${report.cadenceMinutes} min` : `${report.cadenceMinutes / 60} hr`}</small>{report.sourceUrl && <a href={report.sourceUrl} target="_blank" rel="noreferrer">{report.sourceLabel ?? 'Source'} <ExternalLink size={10} /></a>}</footer></article>)}</div></section>}
      <section className="workspace-panel action-panel"><header className="panel-header"><div><span>Execution plan</span><h2>PancakeSwap action queue</h2></div><span className="coverage-note">1 live · 3 staged</span></header><div className="action-queue">{strategy.actions.map((action) => <article key={action.id}><span className="action-order">{action.order}</span><div className="action-copy"><div><strong>{action.title}</strong><span>{toolNames[action.tool]}</span></div><p>{action.detail}</p></div><div className="action-meta"><strong>{formatBps(action.allocationBps)}</strong><span className={`coverage coverage-${action.coverage.toLowerCase().replace('_', '-')}`}>{coverageLabel(action.coverage)}</span></div></article>)}</div></section>
      <aside className="workspace-panel policy-panel"><header className="panel-header"><div><span>Hard limits</span><h2>What AI cannot cross</h2></div><ShieldCheck size={22} /></header><dl className="policy-facts"><div><dt>Minimum liquid reserve</dt><dd>{formatBps(strategy.guardrails.minimumReserveBps)}</dd></div><div><dt>Maximum LP exposure</dt><dd>{formatBps(strategy.guardrails.maximumLiquidityBps)}</dd></div><div><dt>Single position cap</dt><dd>{formatBps(strategy.guardrails.maximumSinglePositionBps)}</dd></div><div><dt>Execution cost ceiling</dt><dd>{formatBps(strategy.guardrails.maximumExecutionCostBps)}</dd></div><div><dt>Leverage</dt><dd>Blocked</dd></div></dl>{latest && <div className="latest-proof"><span>Latest onchain proof</span><strong>{latest.state.replace('_', ' ')}</strong>{latest.transactionHash ? <a href={txUrl(latest.transactionHash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a> : <small>No transaction required</small>}</div>}</aside>
    </div>
    {!runtimeAvailable && mandate.status === 'Active' && <div className="runtime-notice"><AlertTriangle size={18} /><div><strong>The execution key is not available in this browser session.</strong><span>The onchain policy remains active and revocable. Create a replacement runtime to resume automatic reviews.</span></div><button onClick={onCreate}>Replace runtime</button></div>}
  </div>
}

function MandateWizard({
  snapshot, snapshotLoading, account, isTargetNetwork, walletError,
  altanaAddress, altanaBalance, altanaFunded, altanaStage, altanaError,
  isPasskeySupported, onConnect, onSwitchNetwork, onCreateAltana, onRecoverAltana,
  onFundAltana, onStart, onCancel,
}: {
  snapshot: PortfolioSnapshot | null
  snapshotLoading: boolean
  account: `0x${string}` | null
  isTargetNetwork: boolean
  walletError: string
  altanaAddress: `0x${string}` | null
  altanaBalance: string
  altanaFunded: boolean
  altanaStage: AltanaStage
  altanaError: string
  isPasskeySupported: boolean
  onConnect: () => void
  onSwitchNetwork: () => void
  onCreateAltana: () => void
  onRecoverAltana: () => void
  onFundAltana: () => void
  onStart: (draft: MandateDraft) => Promise<void>
  onCancel: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [draft, setDraft] = useState<MandateDraft>({ amount: '0.005', duration: 30, goal: 'balanced-growth', risk: 'balanced', liquidityNeed: 'weekly' })
  const [quote, setQuote] = useState<PortfolioRebalanceQuote | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const [starting, setStarting] = useState(false)
  const managedAmount = safeParseNative(draft.amount)
  const planningSnapshot = useMemo<PortfolioSnapshot>(() => snapshot ?? {
    nativeBalance: managedAmount + GAS_RESERVE,
    stableBalance: 0n,
    priceStablePerNative: parseEther('500'),
    updatedAt: new Date().toISOString(),
  }, [managedAmount, snapshot])
  const strategy = useMemo(() => buildStrategyPlan({ goal: draft.goal, risk: draft.risk, liquidityNeed: draft.liquidityNeed, horizonDays: draft.duration }), [draft])
  const executionPlan = useMemo(() => buildPortfolioPlan({ snapshot: planningSnapshot, managedAmount, goal: draft.goal, risk: draft.risk, targetReserveBps: BigInt(allocationFor(strategy, 'reserve')) }), [draft.goal, draft.risk, managedAmount, planningSnapshot, strategy])
  const usableQuote = quote?.amountIn === executionPlan.amountIn && quote.inputSymbol === executionPlan.inputAsset ? quote : null
  const busy = starting || !['idle', 'error'].includes(altanaStage)
  const amountValid = managedAmount >= parseEther('0.001') && managedAmount <= parseEther('0.05')
  const ready = Boolean(account && isTargetNetwork && altanaAddress && altanaFunded)
  const selectedGoal = goalOptions.find((goal) => goal.id === draft.goal) ?? goalOptions[1]
  const selectedRisk = riskProfiles[draft.risk]

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [step])

  useEffect(() => {
    if (executionPlan.action === 'HOLD') return
    let active = true
    void import('./integrations/altana')
      .then(({ quotePortfolioPlan }) => quotePortfolioPlan(executionPlan))
      .then((next) => { if (active) { setQuote(next); setQuoteError('') } })
      .catch((error: unknown) => { if (active) setQuoteError(error instanceof Error ? error.message : 'Live swap quote unavailable.') })
    return () => { active = false }
  }, [executionPlan])

  async function start() {
    setStarting(true)
    try { await onStart(draft) } finally { setStarting(false) }
  }

  return <div className="configurator-page">
    <header className="configurator-header"><button className="icon-button" disabled={busy} onClick={onCancel} aria-label="Back to portfolio"><X size={18} /></button><div><span className="eyebrow">New managed strategy</span><h1>Tell the AI how your capital should work</h1><p>MandateFi composes the strategy first. Wallet authority is requested only after you review it.</p></div></header>
    <nav className="setup-progress" aria-label="Strategy setup progress">
      {[{ id: 1, name: 'Preferences', detail: 'Goal, risk and access' }, { id: 2, name: 'Strategy', detail: 'Allocation and actions' }, { id: 3, name: 'Approve', detail: 'Wallet and policy' }].map((item, index) => <div className="progress-item" key={item.id}><button className={step === item.id ? 'active' : step > item.id ? 'complete' : ''} disabled={step < item.id} onClick={() => setStep(item.id as 1 | 2 | 3)}><span>{step > item.id ? <Check size={14} /> : item.id}</span><div><strong>{item.name}</strong><small>{item.detail}</small></div></button>{index < 2 && <i />}</div>)}
    </nav>
    <div className="configurator-grid">
      <section className="configurator-card">
        {step === 1 && <>
          <div className="config-section first"><div className="config-section-heading"><span>Capital</span><small>Maximum amount this mandate may manage</small></div><label className="amount-field" htmlFor="managed-capital"><span>Managed capital</span><div><input id="managed-capital" inputMode="decimal" autoComplete="off" spellCheck={false} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} aria-invalid={!amountValid} aria-describedby="capital-help" /><b>tBNB</b></div><small id="capital-help" className={!amountValid ? 'field-error' : ''}>{amountValid ? 'A 0.0015 tBNB gas reserve stays outside the mandate.' : 'Enter an amount from 0.001 to 0.05 tBNB.'}</small></label><div className="quick-values">{['0.003', '0.005', '0.008'].map((value) => <button type="button" key={value} className={draft.amount === value ? 'active' : ''} onClick={() => setDraft({ ...draft, amount: value })}>{value}</button>)}</div></div>
          <div className="config-section"><div className="config-section-heading"><span>Outcome</span><small>What should the AI optimise for?</small></div><fieldset className="option-field"><legend>Primary objective</legend><div>{goalOptions.map((goal) => <button type="button" aria-pressed={draft.goal === goal.id} key={goal.id} className={draft.goal === goal.id ? 'active' : ''} onClick={() => setDraft({ ...draft, goal: goal.id })}><strong>{goal.name}</strong><small>{goal.description}</small></button>)}</div></fieldset></div>
          <div className="config-section"><div className="config-section-heading"><span>Risk tolerance</span><small>Controls position sizing and hard limits</small></div><fieldset className="segmented-field"><legend>Risk tolerance</legend><div>{Object.values(riskProfiles).map((risk) => <button type="button" aria-pressed={draft.risk === risk.id} key={risk.id} className={draft.risk === risk.id ? 'active' : ''} onClick={() => setDraft({ ...draft, risk: risk.id })}>{risk.name}</button>)}</div></fieldset><p className="selection-explainer"><Gauge size={15} /> {selectedRisk.description}</p></div>
          <div className="config-section config-pair"><div><div className="config-section-heading"><span>Withdrawal access</span></div><fieldset className="segmented-field"><legend>Withdrawal access</legend><div>{liquidityOptions.map((option) => <button type="button" aria-pressed={draft.liquidityNeed === option.id} key={option.id} className={draft.liquidityNeed === option.id ? 'active' : ''} onClick={() => setDraft({ ...draft, liquidityNeed: option.id })}>{option.name}</button>)}</div></fieldset><p className="field-note">{liquidityOptions.find((item) => item.id === draft.liquidityNeed)?.description}</p></div><div><div className="config-section-heading"><span>Strategy horizon</span></div><fieldset className="segmented-field"><legend>Strategy horizon</legend><div>{[7, 14, 30].map((days) => <button type="button" aria-pressed={draft.duration === days} key={days} className={draft.duration === days ? 'active' : ''} onClick={() => setDraft({ ...draft, duration: days })}>{days} days</button>)}</div></fieldset></div></div>
          <footer className="config-actions"><div><ShieldCheck size={17} /><span>No wallet permission is requested yet.</span></div><button className="primary-button" disabled={!amountValid} onClick={() => setStep(2)}>Generate strategy <ArrowRight size={17} /></button></footer>
        </>}

        {step === 2 && <>
          <div className="strategy-review-intro"><span className="eyebrow">AI recommendation</span><h2>{selectedGoal.name} across four strategy sleeves</h2><p>{strategy.summary}</p></div>
          <div className="strategy-review-allocation"><StrategyBar plan={strategy} /></div>
          <div className="review-actions">{strategy.actions.map((action) => <article key={action.id}><span className="action-order">{action.order}</span><div><strong>{action.title}</strong><p>{action.detail}</p><small>{toolNames[action.tool]}</small></div><aside><b>{formatBps(action.allocationBps)}</b><span className={`coverage coverage-${action.coverage.toLowerCase().replace('_', '-')}`}>{coverageLabel(action.coverage)}</span></aside></article>)}</div>
          <details className="advanced-policy"><summary><ShieldCheck size={17} /><span><strong>Hard policy limits</strong><small>These limits override every AI recommendation</small></span><ChevronRight size={16} /></summary><div className="advanced-policy-grid"><div><span>Minimum reserve</span><strong>{formatBps(strategy.guardrails.minimumReserveBps)}</strong></div><div><span>Maximum LP</span><strong>{formatBps(strategy.guardrails.maximumLiquidityBps)}</strong></div><div><span>Maximum slippage</span><strong>{formatBps(strategy.guardrails.maximumSlippageBps)}</strong></div><div><span>Leverage</span><strong>Blocked</strong></div></div></details>
          {quoteError && <div className="inline-warning"><AlertTriangle size={16} /><span>The strategy remains reviewable, but the live testnet Swap quote is unavailable: {quoteError}</span></div>}
          <footer className="config-actions"><button className="secondary-button" onClick={() => setStep(1)}>Edit preferences</button><button className="primary-button" onClick={() => setStep(3)}>Review permissions <ArrowRight size={17} /></button></footer>
        </>}

        {step === 3 && <>
          <div className="approval-intro"><span className="eyebrow">Owner approval</span><h2>Connect, fund, and authorise</h2><p>The AI receives a separate session key. Your passkey remains the wallet admin.</p></div>
          <div className="approval-checklist">
            <div className={account && isTargetNetwork ? 'complete' : ''}><span>{account && isTargetNetwork ? <Check size={16} /> : <Wallet size={16} />}</span><div><strong>Funding wallet</strong><small>{account ? `${shortAddress(account)} · ${isTargetNetwork ? 'BNB Testnet' : 'wrong network'}` : 'Connect an injected wallet'}</small></div>{!account ? <button onClick={onConnect}>Connect</button> : !isTargetNetwork ? <button onClick={onSwitchNetwork}>Switch</button> : null}</div>
            <div className={altanaAddress ? 'complete' : ''}><span>{altanaAddress ? <Check size={16} /> : <Fingerprint size={16} />}</span><div><strong>Passkey smart wallet</strong><small>{altanaAddress ? shortAddress(altanaAddress) : 'Owner-controlled account'}</small></div>{!altanaAddress && <div className="inline-actions"><button disabled={!isPasskeySupported || busy} onClick={onCreateAltana}>Create</button><button disabled={!isPasskeySupported || busy} onClick={onRecoverAltana}>Recover</button></div>}</div>
            <div className={altanaFunded ? 'complete' : ''}><span>{altanaFunded ? <Check size={16} /> : <Fuel size={16} />}</span><div><strong>Execution capital</strong><small>{altanaAddress ? `${altanaBalance} tBNB available` : 'Fund after wallet creation'}</small></div>{altanaAddress && !altanaFunded && <button disabled={busy} onClick={onFundAltana}>Fund 0.01</button>}</div>
          </div>
          <div className="approval-boundary"><KeyRound size={18} /><div><strong>Exact scope granted today</strong><span>Live testnet Swap methods, token approval, daily spend caps, and {draft.duration}-day expiry. LP and Farm adapters remain approval-gated until connected.</span></div></div>
          {busy && <div className="operation-status"><LoaderCircle className="spin" size={16} /> {starting ? 'Starting the strategy...' : altanaStageCopy[altanaStage]}</div>}
          {!isPasskeySupported && <div className="inline-error"><AlertTriangle size={16} /> This browser does not expose WebAuthn passkeys.</div>}
          {(walletError || altanaError) && <div className="inline-error"><AlertTriangle size={16} /> {walletError || altanaError}</div>}
          <footer className="config-actions"><button className="secondary-button" disabled={busy} onClick={() => setStep(2)}>Back to strategy</button><button className="primary-button" disabled={!ready || busy} aria-busy={busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Fingerprint size={16} />} Approve and start</button></footer>
        </>}
      </section>

      <aside className="strategy-preview">
        <div className="strategy-preview-head"><div><span>Generated strategy preview</span><strong>{selectedGoal.name}</strong></div><span className="network-pill"><i /> BNB Testnet</span></div>
        <div className="strategy-capital"><span>Capital assigned</span><strong>{draft.amount || '0'} <small>tBNB</small></strong><small>{selectedRisk.name} risk · {draft.duration} days</small></div>
        <StrategyBar plan={strategy} />
        <div className="preview-metrics"><div><span>Model yield</span><strong>{formatBps(strategy.modelYieldBps)}</strong></div><div><span>Risk score</span><strong>{strategy.riskScore}/10</strong></div><div><span>Review</span><strong>{strategy.reviewCadence}</strong></div></div>
        <div className="preview-live-route"><Route size={17} /><div><span>Live executor</span><strong>{executionActionLabel(executionPlan.action)}</strong><small>{usableQuote ? `Quoted ${usableQuote.outputSymbol}` : executionPlan.action === 'HOLD' ? 'No swap required' : snapshotLoading ? 'Loading quote...' : 'Quote pending'}</small></div></div>
        <div className="preview-guardrail"><ShieldCheck size={17} /><span>The AI can recommend opportunities only inside these allocations and limits. Automatic execution also requires a live, owner-approved adapter.</span></div>
      </aside>
    </div>
  </div>
}

function DecisionLog({ mandates }: { mandates: Mandate[] }) {
  const decisions = mandates.flatMap((mandate) => mandate.decisions.map((decision) => ({ mandate, decision }))).sort((a, b) => b.decision.createdAt.localeCompare(a.decision.createdAt))
  return <div className="list-page"><div className="page-title-row"><div><span className="eyebrow">Execution evidence</span><h1>Activity</h1><p>Every expert recommendation, deterministic risk-gate result, and confirmed route remains distinguishable in one audit trail.</p></div></div>{decisions.length === 0 ? <div className="simple-empty"><Activity size={26} /><h2>No activity yet</h2><p>Create a strategy to generate its first decision.</p></div> : <div className="decision-log">{decisions.map(({ mandate, decision }) => <article key={decision.id}><div className={`decision-icon ${decision.action.toLowerCase()}`}>{decision.action === 'HOLD' ? <Pause size={17} /> : <ArrowDownUp size={17} />}</div><div className="decision-copy"><div><strong>{decision.expertAction?.replaceAll('_', ' ') ?? executionActionLabel(decision.action)}</strong><span>{mandate.name}</span></div><p>{decision.rationale}</p><div className="decision-tags"><span>Reserve {allocationLabel(decision.currentStableBps)}</span>{decision.gateStatus && <span>Gate: {decision.gateStatus.replaceAll('_', ' ')}</span>}{decision.reviewSource && <span>{decision.reviewSource}</span>}{decision.triggers?.map((trigger) => <span key={trigger}>{trigger.replaceAll('_', ' ')}</span>)}{decision.amountIn !== '0' && <span>{decision.amountIn} {decision.inputAsset}</span>}</div></div><div className="decision-evidence"><strong className={`evidence-${decision.state.toLowerCase()}`}>{decision.state.replace('_', ' ')}</strong><span>{new Date(decision.createdAt).toLocaleString()}</span>{decision.promptVersion && <span>{decision.promptVersion}</span>}{decision.transactionHash && <a href={txUrl(decision.transactionHash)} target="_blank" rel="noreferrer">Explorer <ExternalLink size={12} /></a>}</div></article>)}</div>}</div>
}

function Policies({ mandates, revokingId, onPause, onRevoke, onCreate }: { mandates: Mandate[]; revokingId: string; onPause: (id: string) => void; onRevoke: (id: string) => void; onCreate: () => void }) {
  return <div className="list-page"><div className="page-title-row"><div><span className="eyebrow">Owner control</span><h1>Guardrails</h1><p>AI strategy selection is flexible. Triggers, execution adapters, position limits, expiry, and revocation remain deterministic.</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} /> New strategy</button></div>{mandates.length === 0 ? <div className="simple-empty"><ShieldCheck size={26} /><h2>No active mandates</h2><p>Create a strategy to register a scoped session on BNB Testnet.</p></div> : <><section className="trigger-policy-band"><header><BrainCircuit size={20} /><div><strong>When the manager wakes up</strong><span>One-minute monitoring scans these conditions. It does not trade by itself.</span></div><b>Prompt v3</b></header><div><span><RefreshCw size={15} /><strong>Schedule</strong><small>4h, 8h, or daily</small></span><span><BarChart3 size={15} /><strong>Allocation drift</strong><small>Outside approved band</small></span><span><Waves size={15} /><strong>LP risk</strong><small>Range edge or IL limit</small></span><span><TrendingUp size={15} /><strong>Yield change</strong><small>Net benefit improves 2.5%</small></span><span><AlertTriangle size={15} /><strong>Protocol risk</strong><small>Depeg or liquidity drop</small></span><span><Wallet size={15} /><strong>Owner events</strong><small>Cash flow, expiry, manual</small></span></div></section><div className="policy-list">{mandates.map((mandate) => { const strategy = planForMandate(mandate); return <article key={mandate.id}><div className="policy-head"><div className="policy-icon"><ShieldCheck size={20} /></div><div><strong>{mandate.name}</strong><span>{riskProfiles[mandate.riskProfile].name} · {mandate.managedAmount} tBNB</span></div><strong className={`status-${mandate.status.toLowerCase()}`}><i /> {mandate.status}</strong></div><div className="policy-details"><div><span>Review cadence</span><strong>{strategy.reviewCadence}</strong></div><div><span>Action cooldown</span><strong>{strategy.guardrails.minimumActionCooldownMinutes} minutes</strong></div><div><span>Minimum reserve</span><strong>{formatBps(strategy.guardrails.minimumReserveBps)}</strong></div><div><span>Expiry</span><strong>{new Date(mandate.expiry * 1000).toLocaleDateString()}</strong></div></div><div className="policy-scope"><span><Check size={14} /> PancakeSwap Swap live</span><span><Check size={14} /> LP owner approval</span><span><Check size={14} /> No leverage</span><span><Check size={14} /> Typed actions only</span><span><Check size={14} /> Altana onchain caps</span></div><footer><div>{mandate.grantTxHash && <a href={txUrl(mandate.grantTxHash)} target="_blank" rel="noreferrer">Grant transaction <ExternalLink size={12} /></a>}</div><div>{mandate.status !== 'Revoked' && <button className="secondary-button" onClick={() => onPause(mandate.id)}>{mandate.status === 'Paused' ? <Play size={15} /> : <Pause size={15} />}{mandate.status === 'Paused' ? 'Resume locally' : 'Pause locally'}</button>}<button className="danger-button" disabled={mandate.status === 'Revoked' || revokingId === mandate.id} onClick={() => onRevoke(mandate.id)}>{revokingId === mandate.id ? <LoaderCircle className="spin" size={15} /> : <X size={15} />} {revokingId === mandate.id ? 'Revoking' : 'Revoke onchain'}</button></div></footer></article> })}</div></>}</div>
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mandates, setMandates] = useState<Mandate[]>(loadMandates)
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')
  const [pancakeResearch, setPancakeResearch] = useState<PancakeResearchSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [revokingId, setRevokingId] = useState('')
  const [checkingId, setCheckingId] = useState('')
  const [runtimeMandateIds, setRuntimeMandateIds] = useState<string[]>([])
  const runtimeSessions = useRef(new Map<string, Session>())
  const runtimeBusy = useRef(false)
  const mobileMenuButton = useRef<HTMLButtonElement>(null)
  const mobileCloseButton = useRef<HTMLButtonElement>(null)
  const wallet = useInjectedWallet()
  const altana = useAltanaWallet()

  useEffect(() => { localStorage.setItem(mandateStorageKey, JSON.stringify(mandates)) }, [mandates])
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

  const refreshSnapshot = useCallback(async () => {
    if (!altana.address) { setSnapshot(null); return null }
    setSnapshotLoading(true)
    setSnapshotError('')
    try {
      const { readPortfolioSnapshot } = await import('./integrations/altana')
      const next = await readPortfolioSnapshot(altana.address)
      setSnapshot(next)
      return next
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'Could not read the portfolio.')
      return null
    } finally {
      setSnapshotLoading(false)
    }
  }, [altana.address])

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => { void refreshSnapshot() }, 0)
    const interval = altana.address ? window.setInterval(() => { void refreshSnapshot() }, 30_000) : null
    return () => { window.clearTimeout(initialRefresh); if (interval !== null) window.clearInterval(interval) }
  }, [altana.address, refreshSnapshot])

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

  const activeMandate = mandates.find((mandate) => mandate.status !== 'Revoked') ?? null
  const currentExecutionPlan = useMemo(() => {
    if (!activeMandate || !snapshot) return null
    const strategy = planForMandate(activeMandate)
    return buildPortfolioPlan({
      snapshot,
      managedAmount: safeParseNative(activeMandate.managedAmount),
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
      const nextSnapshot = await refreshSnapshot()
      if (!nextSnapshot) throw new Error('Portfolio data is unavailable.')
      const strategy = planForMandate(mandate)
      const plan = buildPortfolioPlan({
        snapshot: nextSnapshot,
        managedAmount: safeParseNative(mandate.managedAmount),
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
      const committee = buildInvestmentCommittee({ strategy, executionPlan: plan, snapshot: nextSnapshot, executionCost, pancakeResearch })
      const review = orchestrateStrategyReview({
        source,
        mandate: {
          goal: mandate.goal,
          riskProfile: mandate.riskProfile,
          managedAmount: mandate.managedAmount,
          horizonDays: mandate.duration,
          liquidityNeed: mandate.liquidityNeed ?? 'weekly',
          expiry: mandate.expiry,
        },
        strategy,
        executionPlan: plan,
        lastReviewAt: mandate.decisions[0]?.createdAt,
        lastExecutionAt: mandate.decisions.find((decision) => decision.gateStatus === 'AUTO_EXECUTE')?.createdAt,
        committee,
      })
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
      await refreshSnapshot()
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
  }, [mandates, pancakeResearch, refreshSnapshot])

  useEffect(() => {
    if (!activeMandate || activeMandate.status !== 'Active' || !runtimeMandateIds.includes(activeMandate.id)) return
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void runPolicyCheck(activeMandate.id, true, 'MONITOR') }, 60_000)
    return () => window.clearInterval(interval)
  }, [activeMandate, runPolicyCheck, runtimeMandateIds])

  async function fundAltanaWallet() {
    if (!wallet.provider || !wallet.account) return
    await altana.fund(wallet.provider, wallet.account)
    await wallet.refresh()
    await refreshSnapshot()
    setNotice('Smart wallet funded with 0.01 tBNB.')
  }

  async function startMandate(draft: MandateDraft) {
    if (!altana.address) return
    const latestSnapshot = await refreshSnapshot()
    if (!latestSnapshot) throw new Error('Portfolio data is unavailable.')
    const strategy = buildStrategyPlan({ goal: draft.goal, risk: draft.risk, liquidityNeed: draft.liquidityNeed, horizonDays: draft.duration })
    const executionPlan = buildPortfolioPlan({
      snapshot: latestSnapshot,
      managedAmount: safeParseNative(draft.amount),
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
    const committee = buildInvestmentCommittee({ strategy, executionPlan, snapshot: latestSnapshot, executionCost, pancakeResearch })
    const review = orchestrateStrategyReview({
      source: 'ACTIVATION',
      mandate: {
        goal: draft.goal,
        riskProfile: draft.risk,
        managedAmount: draft.amount,
        horizonDays: draft.duration,
        liquidityNeed: draft.liquidityNeed,
        expiry: Math.floor(Date.now() / 1_000) + draft.duration * 24 * 60 * 60,
      },
      strategy,
      executionPlan,
      committee,
    })
    const proof = await altana.activatePortfolio(draft.duration, executionPlan, review.gate.status === 'AUTO_EXECUTE')
    const id = crypto.randomUUID()
    runtimeSessions.current.set(id, proof.session)
    setRuntimeMandateIds((current) => [...current, id])
    const decision = buildDecision(executionPlan, proof, review)
    const goalName = goalOptions.find((goal) => goal.id === draft.goal)?.name ?? 'Managed portfolio'
    const strategyAllocations = Object.fromEntries(strategy.sleeves.map((sleeve) => [sleeve.id, sleeve.allocationBps])) as Record<StrategySleeveId, number>
    const mandate: Mandate = {
      id,
      name: `${goalName} strategy`,
      goal: draft.goal,
      riskProfile: draft.risk,
      managedAmount: draft.amount,
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
      decisions: [decision],
    }
    setMandates((current) => [mandate, ...current])
    await refreshSnapshot()
    setView('overview')
    setNotice(proof.execution?.status === 'CONFIRMED' ? 'Strategy activated and its first live Swap route confirmed.' : executionPlan.action === 'HOLD' ? 'Strategy activated. No initial Swap is required.' : 'Strategy activated. Review Activity for live execution details.')
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

  function togglePause(id: string) {
    setMandates((current) => current.map((item) => item.id === id && item.status !== 'Revoked' ? { ...item, status: item.status === 'Paused' ? 'Active' : 'Paused' } : item))
  }

  return <div className="app-shell">
    <header className="app-header"><div className="app-header-inner">
      <button className="header-brand" onClick={() => setView('overview')}><span className="brand-mark"><BarChart3 size={19} /></span><span><strong>MandateFi</strong><small>AI DeFi Manager</small></span></button>
      <nav className="top-navigation">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon size={16} /><span>{item.label}</span>{item.id === 'decisions' && mandates.some((mandate) => mandate.decisions.length) && <b>{mandates.reduce((sum, mandate) => sum + mandate.decisions.length, 0)}</b>}</button> })}</nav>
      <div className="header-actions"><span className="header-network"><i className={wallet.isTargetNetwork ? 'online' : ''} /> BNB Testnet</span><button className={wallet.isConnected ? 'wallet-button connected' : 'wallet-button'} disabled={wallet.status === 'connecting'} onClick={() => wallet.isConnected && !wallet.isTargetNetwork ? void wallet.switchNetwork() : !wallet.isConnected ? void wallet.connect() : undefined}><Wallet size={17} />{wallet.status === 'connecting' ? 'Connecting...' : wallet.account ? shortAddress(wallet.account) : 'Connect wallet'}</button><button ref={mobileMenuButton} className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button></div>
    </div>
    <nav className={`mobile-navigation ${menuOpen ? 'open' : ''}`}><div><strong>Navigate</strong><button ref={mobileCloseButton} className="icon-button" onClick={closeMobileMenu} aria-label="Close menu"><X size={18} /></button></div>{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); closeMobileMenu() }}><Icon size={18} /><span>{item.label}</span></button> })}<aside><ShieldCheck size={17} /><span><strong>{activeMandate ? activeMandate.name : 'Owner-controlled by default'}</strong><small>{activeMandate ? `${activeMandate.managedAmount} tBNB · ${riskProfiles[activeMandate.riskProfile].name}` : 'Passkey admin and revocable scope'}</small></span></aside></nav>
    </header>
    <button className={`navigation-scrim ${menuOpen ? 'visible' : ''}`} onClick={closeMobileMenu} aria-label="Close navigation" />
    <main className="main-area" inert={menuOpen ? true : undefined} aria-hidden={menuOpen ? true : undefined}><div className="page-content">
      {view === 'overview' && <PortfolioOverview mandate={activeMandate} snapshot={snapshot} executionPlan={currentExecutionPlan} pancakeResearch={pancakeResearch} loading={snapshotLoading} runtimeAvailable={Boolean(activeMandate && runtimeMandateIds.includes(activeMandate.id))} checking={checkingId === activeMandate?.id} onCreate={() => setView('create')} onCheck={() => { if (activeMandate) void runPolicyCheck(activeMandate.id) }} onOpenPolicies={() => setView('policies')} />}
      {view === 'create' && <MandateWizard snapshot={snapshot} snapshotLoading={snapshotLoading} account={wallet.account} isTargetNetwork={wallet.isTargetNetwork} walletError={wallet.error} altanaAddress={altana.address} altanaBalance={altana.balance} altanaFunded={altana.hasMinimumBalance} altanaStage={altana.stage} altanaError={altana.error} isPasskeySupported={altana.isPasskeySupported} onConnect={() => void wallet.connect()} onSwitchNetwork={() => void wallet.switchNetwork()} onCreateAltana={() => void altana.create().catch(() => undefined)} onRecoverAltana={() => void altana.recover().catch(() => undefined)} onFundAltana={() => void fundAltanaWallet().catch(() => undefined)} onStart={startMandate} onCancel={() => setView('overview')} />}
      {view === 'decisions' && <DecisionLog mandates={mandates} />}
      {view === 'policies' && <Policies mandates={mandates} revokingId={revokingId} onPause={togglePause} onRevoke={(id) => void revokeMandate(id)} onCreate={() => setView('create')} />}
      {view === 'about' && <AboutPage onCreate={() => setView('create')} />}
    </div></main>
    {snapshotError && <div className="toast error-toast"><AlertTriangle size={17} /><span>{snapshotError}</span><button onClick={() => void refreshSnapshot()} aria-label="Retry portfolio data"><RefreshCw size={15} /></button></div>}
    {notice && <div className="toast"><CircleCheck size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {(wallet.error || altana.error) && view !== 'create' && <div className="toast error-toast"><AlertTriangle size={17} /><span>{wallet.error || altana.error}</span><button onClick={() => { wallet.clearError(); altana.clearError() }} aria-label="Dismiss error"><X size={15} /></button></div>}
  </div>
}

export default App
