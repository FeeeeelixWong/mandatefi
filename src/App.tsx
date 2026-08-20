import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownUp, ArrowRight, BarChart3, BrainCircuit,
  Check, ChevronRight, CircleCheck, Clock3, ExternalLink,
  Fingerprint, Fuel, Gauge, KeyRound, LayoutDashboard, LoaderCircle, LockKeyhole,
  Menu, Pause, Play, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles,
  TrendingUp, Wallet, X,
} from 'lucide-react'
import { parseEther } from 'viem'
import type { Session } from '@altananetwork/sdk'
import {
  buildPortfolioPlan, formatNative, formatPercent, formatStable, GAS_RESERVE,
  goalOptions, riskProfiles, type InvestmentGoal, type PortfolioPlan,
  type PortfolioSnapshot, type RiskProfileId,
} from './domain/portfolio'
import { useAltanaWallet, type AltanaStage } from './hooks/useAltanaWallet'
import { useInjectedWallet } from './hooks/useInjectedWallet'
import { BSC_TESTNET_EXPLORER_URL } from './lib/chains'
import { shortAddress } from './lib/wallet'
import type { AltanaPortfolioProof, PortfolioRebalanceQuote } from './integrations/altana'
import type { DecisionRecord, Mandate } from './types'
import './App.css'

type View = 'overview' | 'create' | 'decisions' | 'policies'

const mandateStorageKey = 'mandatefi.portfolio-mandates.v2'

const navItems: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Portfolio', icon: LayoutDashboard },
  { id: 'create', label: 'New mandate', icon: Plus },
  { id: 'decisions', label: 'Decision log', icon: Activity },
  { id: 'policies', label: 'Policies', icon: ShieldCheck },
]

const altanaStageCopy: Record<AltanaStage, string> = {
  idle: 'Ready',
  creating: 'Creating passkey wallet…',
  recovering: 'Recovering passkey wallet…',
  funding: 'Funding the smart wallet…',
  granting: 'Registering the scoped policy onchain…',
  executing: 'Executing the approved allocation change…',
  revoking: 'Revoking the policy onchain…',
  error: 'Action required',
}

function loadMandates(): Mandate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(mandateStorageKey) ?? '[]')
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
  try {
    return parseEther(value || '0')
  } catch {
    return 0n
  }
}

function txUrl(hash?: `0x${string}`) {
  return hash ? `${BSC_TESTNET_EXPLORER_URL}/tx/${hash}` : '#'
}

function allocationLabel(bps: bigint | number) {
  return `${Number(bps) / 100}%`
}

function actionLabel(action: PortfolioPlan['action']) {
  if (action === 'BUY_STABLE') return 'Increase stable reserve'
  if (action === 'BUY_NATIVE') return 'Increase BNB exposure'
  return 'Hold allocation'
}

function buildDecision(plan: PortfolioPlan, proof?: Pick<AltanaPortfolioProof, 'quote' | 'execution' | 'outputReceived' | 'executionError'>): DecisionRecord {
  const state = plan.action === 'HOLD'
    ? 'POLICY_ONLY'
    : proof?.execution?.status === 'CONFIRMED'
      ? 'CONFIRMED'
      : 'FAILED'
  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action: plan.action,
    state,
    rationale: proof?.executionError ? `${plan.rationale} Execution note: ${proof.executionError}` : plan.rationale,
    currentStableBps: Number(plan.currentStableBps),
    targetStableBps: Number(plan.targetStableBps),
    projectedStableBps: Number(plan.projectedStableBps),
    amountIn: plan.inputAsset === 'tBNB' ? formatNative(plan.amountIn) : formatStable(plan.amountIn),
    inputAsset: plan.inputAsset,
    quotedOutput: proof?.quote ? (proof.quote.outputSymbol === 'tBNB' ? formatNative(proof.quote.quotedOut) : formatStable(proof.quote.quotedOut)) : undefined,
    minimumOutput: proof?.quote ? (proof.quote.outputSymbol === 'tBNB' ? formatNative(proof.quote.minimumOut) : formatStable(proof.quote.minimumOut)) : undefined,
    outputReceived: proof?.outputReceived !== undefined
      ? (plan.outputAsset === 'tBNB' ? formatNative(proof.outputReceived) : formatStable(proof.outputReceived))
      : undefined,
    outputAsset: plan.outputAsset,
    transactionHash: proof?.execution?.transactionHash,
  }
}

function AllocationBar({ stableBps, targetBps, compact = false }: { stableBps: bigint | number; targetBps: bigint | number; compact?: boolean }) {
  const stable = Math.max(0, Math.min(100, Number(stableBps) / 100))
  const target = Math.max(0, Math.min(100, Number(targetBps) / 100))
  return <div className={compact ? 'allocation compact' : 'allocation'}>
    <div className="allocation-labels"><span><i className="native-dot" /> tBNB {100 - stable}%</span><span><i className="stable-dot" /> BUSD {stable}%</span></div>
    <div className="allocation-track" aria-label={`${stable}% BUSD allocation`}>
      <span className="allocation-stable" style={{ width: `${stable}%` }} />
      <i className="target-marker" style={{ left: `${target}%` }} title={`Target ${target}% BUSD`} />
    </div>
    <div className="allocation-scale"><span>0% stable</span><strong>Target {target}%</strong><span>100% stable</span></div>
  </div>
}

function EmptyPortfolio({ onCreate }: { onCreate: () => void }) {
  return <div className="launch-page">
    <section className="launch-intro">
      <span className="product-kicker"><Sparkles size={15} /> Non-custodial AI asset manager</span>
      <h1>AI manages your onchain portfolio.<br />You set the rules.</h1>
      <p>Choose a goal and risk level. MandateFi keeps your BNB/BUSD allocation inside the approved band and uses PancakeSwap only when a bounded rebalance is required.</p>
    </section>
    <section className="launch-workspace" aria-label="Example AI mandate">
      <div className="launch-card">
        <div className="launch-card-head"><div><span>New mandate</span><strong>AI portfolio manager</strong></div><span className="live-pill"><i /> BNB Testnet</span></div>
        <div className="launch-field"><span>Capital to manage</span><div><strong>0.010</strong><b>tBNB</b></div><small>Funds remain in your passkey wallet</small></div>
        <div className="launch-field compact"><span>Objective</span><div><strong>Balanced growth</strong><b>14 days</b></div></div>
        <button className="primary-button launch-action" onClick={onCreate}>Configure mandate <ArrowRight size={18} /></button>
        <div className="launch-safety"><ShieldCheck size={16} /><span>No custody. No unlimited approvals. Revoke anytime.</span></div>
      </div>
      <aside className="launch-preview">
        <div className="preview-head"><span>Live policy preview</span><strong>Balanced risk</strong></div>
        <div className="preview-value"><span>Target allocation</span><strong>45% BUSD</strong><small>Rebalance only outside the 37%–53% band</small></div>
        <AllocationBar stableBps={4500n} targetBps={4500n} compact />
        <div className="preview-policy-list"><div><LockKeyhole size={16} /><span>Rebalance venue</span><strong>PancakeSwap V2</strong></div><div><ArrowDownUp size={16} /><span>Daily rebalance cap</span><strong>0.005 tBNB</strong></div><div><Clock3 size={16} /><span>Policy expiry</span><strong>14 days</strong></div></div>
      </aside>
    </section>
    <div className="launch-trust"><span><Fingerprint size={17} /><b>Passkey owned</b><small>You remain the smart-wallet admin.</small></span><span><LockKeyhole size={17} /><b>Precisely scoped</b><small>Contracts, methods and caps are explicit.</small></span><span><Activity size={17} /><b>Explainable</b><small>Every hold or trade has evidence.</small></span></div>
  </div>
}

function PortfolioOverview({
  mandate, snapshot, plan, loading, runtimeAvailable, checking, onCreate, onCheck, onOpenPolicies,
}: {
  mandate: Mandate | null
  snapshot: PortfolioSnapshot | null
  plan: PortfolioPlan | null
  loading: boolean
  runtimeAvailable: boolean
  checking: boolean
  onCreate: () => void
  onCheck: () => void
  onOpenPolicies: () => void
}) {
  if (!mandate) return <EmptyPortfolio onCreate={onCreate} />
  const latest = mandate.decisions[0]
  const stableBps = plan?.currentStableBps ?? BigInt(latest?.projectedStableBps ?? mandate.targetStableBps)
  const managedValue = plan?.managedValue ?? safeParseNative(mandate.managedAmount)
  return <div className="dashboard-page">
    <div className="page-title-row">
      <div><span className="eyebrow">AI-managed portfolio</span><h1>{mandate.name}</h1><p>Mandate capital stays in your passkey smart wallet. The agent can act only inside the approved policy.</p></div>
      <div className="title-actions"><button className="secondary-button" onClick={onOpenPolicies}><Settings2 size={16} /> Policy</button><button className="primary-button" disabled={checking || mandate.status !== 'Active'} onClick={onCheck}>{checking ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} Check now</button></div>
    </div>
    <section className="portfolio-status-strip">
      <div><span>Mandate status</span><strong className={`status-${mandate.status.toLowerCase()}`}><i /> {mandate.status}</strong></div>
      <div><span>Local AI runtime</span><strong>{runtimeAvailable ? 'Monitoring every 60 sec' : 'Owner approval required'}</strong></div>
      <div><span>Policy expires</span><strong>{new Date(mandate.expiry * 1000).toLocaleDateString()}</strong></div>
      <div><span>Network</span><strong>BNB Testnet</strong></div>
    </section>
    <div className="dashboard-grid">
      <section className="portfolio-panel main-panel">
        <div className="panel-heading"><div><span>Managed portfolio</span><h2>{loading ? 'Refreshing…' : `${formatNative(managedValue)} tBNB`}</h2></div><span className={`live-pill ${snapshot ? '' : 'waiting'}`}><i /> {snapshot ? 'PancakeSwap live quote' : 'Waiting for wallet data'}</span></div>
        <AllocationBar stableBps={stableBps} targetBps={mandate.targetStableBps} />
        <div className="asset-table">
          <div><span className="asset-symbol native">BNB</span><div><strong>tBNB</strong><small>Growth exposure</small></div><b>{snapshot ? formatNative(snapshot.nativeBalance) : '—'}</b></div>
          <div><span className="asset-symbol stable">$</span><div><strong>BUSD</strong><small>Stable reserve</small></div><b>{snapshot ? formatStable(snapshot.stableBalance) : '—'}</b></div>
        </div>
      </section>
      <section className="portfolio-panel decision-panel">
        <div className="panel-heading"><div><span>Next policy decision</span><h2>{plan ? actionLabel(plan.action) : 'Reading portfolio'}</h2></div><BrainCircuit size={22} /></div>
        {plan && <>
          <p className="decision-rationale">{plan.rationale}</p>
          <dl className="decision-facts"><div><dt>Current stable</dt><dd>{formatPercent(plan.currentStableBps)}</dd></div><div><dt>Target</dt><dd>{formatPercent(plan.targetStableBps)}</dd></div><div><dt>Action size</dt><dd>{plan.action === 'HOLD' ? 'None' : `${plan.inputAsset === 'tBNB' ? formatNative(plan.amountIn) : formatStable(plan.amountIn)} ${plan.inputAsset}`}</dd></div></dl>
          <div className={`decision-state ${plan.action === 'HOLD' ? 'hold' : 'trade'}`}>{plan.action === 'HOLD' ? <CircleCheck size={17} /> : <TrendingUp size={17} />}<span>{plan.action === 'HOLD' ? 'Inside policy band' : 'Rebalance required'}</span></div>
        </>}
      </section>
      <section className="portfolio-panel guardrail-panel">
        <div className="panel-heading"><div><span>Guardrails</span><h2>{riskProfiles[mandate.riskProfile].name} policy</h2></div><ShieldCheck size={22} /></div>
        <div className="guardrail-list"><div><span>Stable target</span><strong>{allocationLabel(mandate.targetStableBps)}</strong></div><div><span>Drift band</span><strong>±{allocationLabel(mandate.driftBandBps)}</strong></div><div><span>Max slippage</span><strong>{allocationLabel(mandate.maxSlippageBps)}</strong></div><div><span>Daily tBNB cap</span><strong>{mandate.dailyNativeCap}</strong></div></div>
      </section>
      <section className="portfolio-panel latest-panel">
        <div className="panel-heading"><div><span>Latest decision</span><h2>{latest ? actionLabel(latest.action) : 'No decisions yet'}</h2></div>{latest?.state === 'CONFIRMED' ? <CircleCheck size={22} /> : <Activity size={22} />}</div>
        {latest && <><p>{latest.rationale}</p><div className="latest-meta"><span>{new Date(latest.createdAt).toLocaleString()}</span><strong className={`evidence-${latest.state.toLowerCase()}`}>{latest.state.replace('_', ' ')}</strong></div>{latest.transactionHash && <a href={txUrl(latest.transactionHash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} /></a>}</>}
      </section>
    </div>
    {!runtimeAvailable && mandate.status === 'Active' && <div className="runtime-notice"><AlertTriangle size={18} /><div><strong>The local execution key is no longer in this browser session.</strong><span>The onchain policy is still active and revocable, but autonomous checks require owner approval for a replacement runtime. Production uses a secure always-on executor.</span></div><button onClick={onCreate}>Create replacement</button></div>}
  </div>
}
type MandateDraft = {
  amount: string
  duration: number
  goal: InvestmentGoal
  risk: RiskProfileId
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
  const [step, setStep] = useState<1 | 2>(1)
  const [draft, setDraft] = useState<MandateDraft>({ amount: '0.005', duration: 14, goal: 'balanced-growth', risk: 'balanced' })
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
  const plan = useMemo(() => buildPortfolioPlan({ snapshot: planningSnapshot, managedAmount, goal: draft.goal, risk: draft.risk }), [draft.goal, draft.risk, managedAmount, planningSnapshot])
  const usableQuote = quote?.amountIn === plan.amountIn && quote.inputSymbol === plan.inputAsset ? quote : null
  const busy = starting || !['idle', 'error'].includes(altanaStage)
  const amountValid = managedAmount >= parseEther('0.001') && managedAmount <= parseEther('0.05')
  const ready = Boolean(account && isTargetNetwork && altanaAddress && altanaFunded)
  const selectedGoal = goalOptions.find((goal) => goal.id === draft.goal) ?? goalOptions[1]
  const selectedRisk = riskProfiles[draft.risk]

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [step])

  useEffect(() => {
    if (step !== 1 || plan.action === 'HOLD') return
    let active = true
    void import('./integrations/altana').then(({ quotePortfolioPlan }) => quotePortfolioPlan(plan)).then((next) => {
      if (active) {
        setQuote(next)
        setQuoteError('')
      }
    }).catch((error: unknown) => {
      if (active) setQuoteError(error instanceof Error ? error.message : 'Live quote unavailable.')
    })
    return () => { active = false }
  }, [plan, step])

  async function start() {
    setStarting(true)
    try { await onStart(draft) } finally { setStarting(false) }
  }

  return <div className="configurator-page">
    <header className="configurator-header">
      <button className="icon-button" disabled={busy} onClick={onCancel} aria-label="Back to portfolio"><X size={18} /></button>
      <div><span className="eyebrow">New AI mandate</span><h1>Configure your portfolio mandate</h1><p>One setup surface. A live policy preview. Owner approval only at the end.</p></div>
    </header>
    <nav className="setup-progress" aria-label="Mandate setup progress">
      <button className={step === 1 ? 'active' : 'complete'} onClick={() => setStep(1)}><span>{step > 1 ? <Check size={14} /> : '1'}</span><div><strong>Configure</strong><small>Capital, objective and risk</small></div></button>
      <i />
      <button className={step === 2 ? 'active' : ''} disabled={step === 1}><span>2</span><div><strong>Approve</strong><small>Wallet and onchain policy</small></div></button>
    </nav>
    <div className="configurator-grid">
      <section className="configurator-card">
        {step === 1 ? <>
          <div className="config-section first">
            <div className="config-section-heading"><span>Capital</span><small>Maximum amount the AI can manage</small></div>
            <label className="amount-field"><span>Managed capital</span><div><input aria-label="Managed capital" type="number" min="0.001" max="0.05" step="0.001" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /><b>tBNB</b></div><small className={!amountValid ? 'field-error' : ''}>{amountValid ? 'A 0.0015 tBNB gas reserve stays outside this scope.' : 'Enter an amount from 0.001 to 0.05 tBNB.'}</small></label>
            <div className="quick-values">{['0.003', '0.005', '0.008'].map((value) => <button type="button" key={value} className={draft.amount === value ? 'active' : ''} onClick={() => setDraft({ ...draft, amount: value })}>{value}</button>)}</div>
          </div>
          <div className="config-section">
            <div className="config-section-heading"><span>Objective</span><small>What the portfolio should optimise for</small></div>
            <fieldset className="segmented-field"><legend>Primary objective</legend><div>{goalOptions.map((goal) => <button type="button" key={goal.id} className={draft.goal === goal.id ? 'active' : ''} onClick={() => setDraft({ ...draft, goal: goal.id })}>{goal.name}</button>)}</div></fieldset>
            <p className="selection-explainer"><Sparkles size={15} /> {selectedGoal.description}</p>
          </div>
          <div className="config-section">
            <div className="config-section-heading"><span>Risk and duration</span><small>How tightly the policy should react</small></div>
            <fieldset className="segmented-field"><legend>Risk tolerance</legend><div>{Object.values(riskProfiles).map((risk) => <button type="button" key={risk.id} className={draft.risk === risk.id ? 'active' : ''} onClick={() => setDraft({ ...draft, risk: risk.id })}>{risk.name}</button>)}</div></fieldset>
            <p className="selection-explainer"><Gauge size={15} /> {selectedRisk.description} Rebalances outside a ±{formatPercent(selectedRisk.driftBandBps)} band.</p>
            <fieldset className="segmented-field duration-segment"><legend>Policy duration</legend><div>{[7, 14, 30].map((days) => <button type="button" key={days} className={draft.duration === days ? 'active' : ''} onClick={() => setDraft({ ...draft, duration: days })}>{days} days</button>)}</div></fieldset>
          </div>
          <details className="advanced-policy">
            <summary><Settings2 size={16} /><span><strong>Advanced policy limits</strong><small>Contract scope, slippage and daily caps</small></span><ChevronRight size={16} /></summary>
            <div className="advanced-policy-grid"><div><span>Allowed venue</span><strong>PancakeSwap V2</strong></div><div><span>Maximum slippage</span><strong>{formatPercent(plan.maxSlippageBps)}</strong></div><div><span>Daily native cap</span><strong>{formatNative(plan.dailyNativeCap)} tBNB</strong></div><div><span>Stable target</span><strong>{formatPercent(plan.targetStableBps)} BUSD</strong></div></div>
          </details>
          {quoteError && <div className="inline-error"><AlertTriangle size={16} /> {quoteError}</div>}
          <footer className="config-actions"><div><ShieldCheck size={17} /><span>Nothing is signed on this screen.</span></div><button className="primary-button" disabled={!amountValid || (plan.action !== 'HOLD' && !usableQuote)} onClick={() => setStep(2)}>Review and approve <ArrowRight size={17} /></button></footer>
        </> : <>
          <div className="approval-intro"><span className="eyebrow">Owner approval</span><h2>Connect, fund and authorise</h2><p>Each action is explicit. Your passkey remains the wallet admin and the AI receives only a revocable session policy.</p></div>
          <div className="approval-checklist compact-checklist">
            <div className={account && isTargetNetwork ? 'complete' : ''}><span>{account && isTargetNetwork ? <Check size={16} /> : <Wallet size={16} />}</span><div><strong>Funding wallet</strong><small>{account ? `${shortAddress(account)} · ${isTargetNetwork ? 'BNB Testnet' : 'wrong network'}` : 'Connect an injected wallet'}</small></div>{!account ? <button onClick={onConnect}>Connect</button> : !isTargetNetwork ? <button onClick={onSwitchNetwork}>Switch</button> : null}</div>
            <div className={altanaAddress ? 'complete' : ''}><span>{altanaAddress ? <Check size={16} /> : <Fingerprint size={16} />}</span><div><strong>Passkey smart wallet</strong><small>{altanaAddress ? shortAddress(altanaAddress) : 'Owner-controlled account'}</small></div>{!altanaAddress && <div className="inline-actions"><button disabled={!isPasskeySupported || busy} onClick={onCreateAltana}>Create</button><button disabled={!isPasskeySupported || busy} onClick={onRecoverAltana}>Recover</button></div>}</div>
            <div className={altanaFunded ? 'complete' : ''}><span>{altanaFunded ? <Check size={16} /> : <Fuel size={16} />}</span><div><strong>Execution capital</strong><small>{altanaAddress ? `${altanaBalance} tBNB available` : 'Fund after wallet creation'}</small></div>{altanaAddress && !altanaFunded && <button disabled={busy} onClick={onFundAltana}>Fund 0.01</button>}</div>
          </div>
          <div className="approval-boundary"><KeyRound size={18} /><div><strong>What the AI receives</strong><span>A separate session key limited to this capital, PancakeSwap methods, daily caps and {draft.duration}-day expiry.</span></div></div>
          {busy && <div className="operation-status"><LoaderCircle className="spin" size={16} /> {starting ? 'Starting the mandate…' : altanaStageCopy[altanaStage]}</div>}
          {!isPasskeySupported && <div className="inline-error"><AlertTriangle size={16} /> This browser does not expose WebAuthn passkeys.</div>}
          {(walletError || altanaError) && <div className="inline-error"><AlertTriangle size={16} /> {walletError || altanaError}</div>}
          <footer className="config-actions"><button className="secondary-button" disabled={busy} onClick={() => setStep(1)}>Back to configuration</button><button className="primary-button start-button" disabled={!ready || busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Fingerprint size={16} />} Approve and start</button></footer>
        </>}
      </section>
      <aside className="strategy-preview">
        <div className="strategy-preview-head"><div><span>Mandate preview</span><strong>{selectedGoal.name}</strong></div><span className="live-pill"><i /> Live</span></div>
        <div className="strategy-capital"><span>Managed capital</span><strong>{draft.amount || '0'} <small>tBNB</small></strong><small>{selectedRisk.name} risk · {draft.duration} days</small></div>
        <AllocationBar stableBps={plan.currentStableBps} targetBps={plan.targetStableBps} compact />
        <div className={`strategy-decision ${plan.action === 'HOLD' ? 'hold' : 'trade'}`}><span>Initial policy decision</span><strong>{actionLabel(plan.action)}</strong><small>{plan.rationale}</small></div>
        <div className="strategy-route"><span className="route-token">{plan.inputAsset}</span><div><ArrowRight size={17} /><small>PancakeSwap</small></div><span className="route-token output">{plan.outputAsset}</span></div>
        <dl className="strategy-facts"><div><dt>Target reserve</dt><dd>{formatPercent(plan.targetStableBps)} BUSD</dd></div><div><dt>Rebalance band</dt><dd>±{formatPercent(plan.driftBandBps)}</dd></div><div><dt>Live quote</dt><dd>{usableQuote ? `≈ ${usableQuote.outputSymbol === 'tBNB' ? formatNative(usableQuote.quotedOut) : formatStable(usableQuote.quotedOut)} ${usableQuote.outputSymbol}` : plan.action === 'HOLD' ? 'No trade' : snapshotLoading ? 'Loading…' : 'Refreshing…'}</dd></div><div><dt>Policy owner</dt><dd>{altanaAddress ? shortAddress(altanaAddress) : 'Your passkey'}</dd></div></dl>
        <div className="preview-guardrail"><ShieldCheck size={17} /><span>AI access is bounded and revocable. MandateFi never receives your owner key.</span></div>
      </aside>
    </div>
  </div>
}

function DecisionLog({ mandates }: { mandates: Mandate[] }) {
  const decisions = mandates.flatMap((mandate) => mandate.decisions.map((decision) => ({ mandate, decision }))).sort((a, b) => b.decision.createdAt.localeCompare(a.decision.createdAt))
  return <div className="list-page"><div className="page-title-row"><div><span className="eyebrow">Explainable automation</span><h1>Decision log</h1><p>Every policy check is recorded, including decisions that correctly produce no transaction.</p></div></div>{decisions.length === 0 ? <div className="simple-empty"><Activity size={26} /><h2>No decisions yet</h2><p>Create a mandate to generate the first allocation decision.</p></div> : <div className="decision-log">{decisions.map(({ mandate, decision }) => <article key={decision.id}><div className={`decision-icon ${decision.action.toLowerCase()}`}>{decision.action === 'HOLD' ? <Pause size={17} /> : <ArrowDownUp size={17} />}</div><div className="decision-copy"><div><strong>{actionLabel(decision.action)}</strong><span>{mandate.name}</span></div><p>{decision.rationale}</p><div className="decision-tags"><span>Current {allocationLabel(decision.currentStableBps)}</span><span>Target {allocationLabel(decision.targetStableBps)}</span>{decision.amountIn !== '0' && <span>{decision.amountIn} {decision.inputAsset}</span>}</div></div><div className="decision-evidence"><strong className={`evidence-${decision.state.toLowerCase()}`}>{decision.state.replace('_', ' ')}</strong><span>{new Date(decision.createdAt).toLocaleString()}</span>{decision.transactionHash && <a href={txUrl(decision.transactionHash)} target="_blank" rel="noreferrer">Explorer <ExternalLink size={12} /></a>}</div></article>)}</div>}</div>
}

function Policies({ mandates, revokingId, onPause, onRevoke, onCreate }: { mandates: Mandate[]; revokingId: string; onPause: (id: string) => void; onRevoke: (id: string) => void; onCreate: () => void }) {
  return <div className="list-page"><div className="page-title-row"><div><span className="eyebrow">Owner control</span><h1>Policies</h1><p>Review the exact authority delegated to the local AI runtime and revoke it at any time.</p></div><button className="primary-button" onClick={onCreate}><Plus size={16} /> New mandate</button></div>{mandates.length === 0 ? <div className="simple-empty"><ShieldCheck size={26} /><h2>No active policies</h2><p>Create a mandate to register a scoped session on BNB Testnet.</p></div> : <div className="policy-list">{mandates.map((mandate) => <article key={mandate.id}><div className="policy-head"><div className="policy-icon"><ShieldCheck size={20} /></div><div><strong>{mandate.name}</strong><span>{riskProfiles[mandate.riskProfile].name} · {mandate.managedAmount} tBNB</span></div><strong className={`status-${mandate.status.toLowerCase()}`}><i /> {mandate.status}</strong></div><div className="policy-details"><div><span>Smart wallet</span><strong title={mandate.smartWallet}>{shortAddress(mandate.smartWallet)}</strong></div><div><span>Stable target</span><strong>{allocationLabel(mandate.targetStableBps)}</strong></div><div><span>Daily cap</span><strong>{mandate.dailyNativeCap} tBNB</strong></div><div><span>Expiry</span><strong>{new Date(mandate.expiry * 1000).toLocaleDateString()}</strong></div></div><div className="policy-scope"><span><Check size={14} /> PancakeSwap V2 router</span><span><Check size={14} /> Two swap methods</span><span><Check size={14} /> BUSD approval only</span><span><Check size={14} /> Altana onchain caps</span></div><footer><div>{mandate.grantTxHash && <a href={txUrl(mandate.grantTxHash)} target="_blank" rel="noreferrer">Grant transaction <ExternalLink size={12} /></a>}</div><div>{mandate.status !== 'Revoked' && <button className="secondary-button" onClick={() => onPause(mandate.id)}>{mandate.status === 'Paused' ? <Play size={15} /> : <Pause size={15} />}{mandate.status === 'Paused' ? 'Resume locally' : 'Pause locally'}</button>}<button className="danger-button" disabled={mandate.status === 'Revoked' || revokingId === mandate.id} onClick={() => onRevoke(mandate.id)}>{revokingId === mandate.id ? <LoaderCircle className="spin" size={15} /> : <X size={15} />} {revokingId === mandate.id ? 'Revoking' : 'Revoke onchain'}</button></div></footer></article>)}</div>}</div>
}

function App() {
  const [view, setView] = useState<View>('overview')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mandates, setMandates] = useState<Mandate[]>(loadMandates)
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState('')
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

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [view])

  useEffect(() => {
    if (menuOpen) mobileCloseButton.current?.focus()
  }, [menuOpen])

  function closeMobileMenu() {
    setMenuOpen(false)
    if (window.matchMedia('(max-width: 760px)').matches) {
      window.requestAnimationFrame(() => mobileMenuButton.current?.focus())
    }
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
    return () => {
      window.clearTimeout(initialRefresh)
      if (interval !== null) window.clearInterval(interval)
    }
  }, [altana.address, refreshSnapshot])

  const activeMandate = mandates.find((mandate) => mandate.status !== 'Revoked') ?? null
  const currentPlan = useMemo(() => activeMandate && snapshot ? buildPortfolioPlan({
    snapshot,
    managedAmount: safeParseNative(activeMandate.managedAmount),
    goal: activeMandate.goal,
    risk: activeMandate.riskProfile,
  }) : null, [activeMandate, snapshot])

  const runPolicyCheck = useCallback(async (mandateId: string, silent = false) => {
    const mandate = mandates.find((item) => item.id === mandateId)
    if (!mandate || mandate.status !== 'Active' || runtimeBusy.current) return
    runtimeBusy.current = true
    setCheckingId(mandateId)
    try {
      const nextSnapshot = await refreshSnapshot()
      if (!nextSnapshot) throw new Error('Portfolio data is unavailable.')
      const plan = buildPortfolioPlan({ snapshot: nextSnapshot, managedAmount: safeParseNative(mandate.managedAmount), goal: mandate.goal, risk: mandate.riskProfile })
      let result: Pick<AltanaPortfolioProof, 'quote' | 'execution' | 'executionError' | 'outputReceived'> | undefined
      if (plan.action !== 'HOLD') {
        const session = runtimeSessions.current.get(mandateId)
        if (!session) throw new Error('This browser no longer holds the scoped runtime key. Create a replacement policy to resume execution.')
        const { executePortfolioPlanWithSession } = await import('./integrations/altana')
        result = await executePortfolioPlanWithSession(session, plan)
      }
      const decision = buildDecision(plan, result)
      setMandates((current) => current.map((item) => item.id === mandateId ? { ...item, decisions: [decision, ...item.decisions] } : item))
      await refreshSnapshot()
      if (!silent) setNotice(plan.action === 'HOLD' ? 'Policy check complete. Allocation remains inside the approved band.' : result?.execution?.status === 'CONFIRMED' ? 'Bounded rebalance confirmed on BNB Testnet.' : 'Policy check completed, but execution did not confirm.')
    } catch (error) {
      if (!silent) setNotice(error instanceof Error ? error.message : 'Policy check failed.')
    } finally {
      runtimeBusy.current = false
      setCheckingId('')
    }
  }, [mandates, refreshSnapshot])

  useEffect(() => {
    if (!activeMandate || activeMandate.status !== 'Active' || !runtimeMandateIds.includes(activeMandate.id)) return
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runPolicyCheck(activeMandate.id, true)
    }, 60_000)
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
    const plan = buildPortfolioPlan({ snapshot: latestSnapshot, managedAmount: safeParseNative(draft.amount), goal: draft.goal, risk: draft.risk })
    const proof = await altana.activatePortfolio(draft.duration, plan)
    const id = crypto.randomUUID()
    runtimeSessions.current.set(id, proof.session)
    setRuntimeMandateIds((current) => [...current, id])
    const decision = buildDecision(plan, proof)
    const goalName = goalOptions.find((goal) => goal.id === draft.goal)?.name ?? 'Managed portfolio'
    const mandate: Mandate = {
      id,
      name: `${goalName} mandate`,
      goal: draft.goal,
      riskProfile: draft.risk,
      managedAmount: draft.amount,
      duration: draft.duration,
      status: 'Active',
      createdAt: new Date().toISOString(),
      chainId: 97,
      smartWallet: proof.session.walletAddress,
      sessionPublicKey: proof.session.publicKey,
      expiry: proof.session.expiry,
      targetStableBps: Number(plan.targetStableBps),
      driftBandBps: Number(plan.driftBandBps),
      maxSlippageBps: Number(plan.maxSlippageBps),
      dailyNativeCap: formatNative(plan.dailyNativeCap),
      dailyStableCap: formatStable(plan.dailyStableCap),
      grantTxHash: proof.grant.transactionHash,
      decisions: [decision],
    }
    setMandates((current) => [mandate, ...current])
    await refreshSnapshot()
    setView('overview')
    setNotice(proof.execution?.status === 'CONFIRMED' ? 'Mandate activated and initial rebalance confirmed.' : plan.action === 'HOLD' ? 'Mandate activated. Allocation is already inside the approved band.' : 'Mandate activated. Review the decision log for execution details.')
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
    } catch {
      // The Altana hook exposes the exact operation error.
    } finally {
      setRevokingId('')
    }
  }

  function togglePause(id: string) {
    setMandates((current) => current.map((item) => item.id === id && item.status !== 'Revoked' ? { ...item, status: item.status === 'Paused' ? 'Active' : 'Paused' } : item))
  }

  return <div className="app-shell">
    <header className="app-header">
      <div className="app-header-inner">
        <button className="header-brand" onClick={() => setView('overview')}><span className="brand-mark"><BarChart3 size={19} /></span><span><strong>MandateFi</strong><small>AI Asset Manager</small></span></button>
        <nav className="top-navigation">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><Icon size={16} /><span>{item.label}</span>{item.id === 'decisions' && mandates.some((mandate) => mandate.decisions.length) && <b>{mandates.reduce((sum, mandate) => sum + mandate.decisions.length, 0)}</b>}</button> })}</nav>
        <div className="header-actions"><span className="header-network"><i className={wallet.isTargetNetwork ? 'online' : ''} /> BNB Testnet</span><button className={wallet.isConnected ? 'wallet-button connected' : 'wallet-button'} disabled={wallet.status === 'connecting'} onClick={() => wallet.isConnected && !wallet.isTargetNetwork ? void wallet.switchNetwork() : !wallet.isConnected ? void wallet.connect() : undefined}><Wallet size={17} />{wallet.status === 'connecting' ? 'Connecting…' : wallet.account ? shortAddress(wallet.account) : 'Connect wallet'}</button><button ref={mobileMenuButton} className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button></div>
      </div>
      <nav className={`mobile-navigation ${menuOpen ? 'open' : ''}`}><div><strong>Navigate</strong><button ref={mobileCloseButton} className="icon-button" onClick={closeMobileMenu} aria-label="Close menu"><X size={18} /></button></div>{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); closeMobileMenu() }}><Icon size={18} /><span>{item.label}</span></button> })}<aside><ShieldCheck size={17} /><span><strong>{activeMandate ? activeMandate.name : 'Owner-controlled by default'}</strong><small>{activeMandate ? `${activeMandate.managedAmount} tBNB · ${riskProfiles[activeMandate.riskProfile].name}` : 'Passkey admin and revocable scope'}</small></span></aside></nav>
    </header>
    <button className={`navigation-scrim ${menuOpen ? 'visible' : ''}`} onClick={closeMobileMenu} aria-label="Close navigation" />
    <main className="main-area" inert={menuOpen ? true : undefined} aria-hidden={menuOpen ? true : undefined}>
      <div className="page-content">
        {view === 'overview' && <PortfolioOverview mandate={activeMandate} snapshot={snapshot} plan={currentPlan} loading={snapshotLoading} runtimeAvailable={Boolean(activeMandate && runtimeMandateIds.includes(activeMandate.id))} checking={checkingId === activeMandate?.id} onCreate={() => setView('create')} onCheck={() => { if (activeMandate) void runPolicyCheck(activeMandate.id) }} onOpenPolicies={() => setView('policies')} />}
        {view === 'create' && <MandateWizard snapshot={snapshot} snapshotLoading={snapshotLoading} account={wallet.account} isTargetNetwork={wallet.isTargetNetwork} walletError={wallet.error} altanaAddress={altana.address} altanaBalance={altana.balance} altanaFunded={altana.hasMinimumBalance} altanaStage={altana.stage} altanaError={altana.error} isPasskeySupported={altana.isPasskeySupported} onConnect={() => void wallet.connect()} onSwitchNetwork={() => void wallet.switchNetwork()} onCreateAltana={() => void altana.create().catch(() => undefined)} onRecoverAltana={() => void altana.recover().catch(() => undefined)} onFundAltana={() => void fundAltanaWallet().catch(() => undefined)} onStart={startMandate} onCancel={() => setView('overview')} />}
        {view === 'decisions' && <DecisionLog mandates={mandates} />}
        {view === 'policies' && <Policies mandates={mandates} revokingId={revokingId} onPause={togglePause} onRevoke={(id) => void revokeMandate(id)} onCreate={() => setView('create')} />}
      </div>
    </main>
    {snapshotError && <div className="toast error-toast"><AlertTriangle size={17} /><span>{snapshotError}</span><button onClick={() => void refreshSnapshot()} aria-label="Retry portfolio data"><RefreshCw size={15} /></button></div>}
    {notice && <div className="toast"><CircleCheck size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {(wallet.error || altana.error) && view !== 'create' && <div className="toast error-toast"><AlertTriangle size={17} /><span>{wallet.error || altana.error}</span><button onClick={() => { wallet.clearError(); altana.clearError() }} aria-label="Dismiss error"><X size={15} /></button></div>}
  </div>
}

export default App
