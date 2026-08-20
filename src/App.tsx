import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownUp, ArrowRight, BarChart3, BrainCircuit,
  Check, ChevronRight, CircleCheck, CircleDollarSign, Clock3, ExternalLink,
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
  return <div className="empty-portfolio">
    <section className="empty-primary">
      <span className="product-kicker"><Sparkles size={15} /> Non-custodial AI asset manager</span>
      <h1>Give AI a mandate.<br />Keep control of the money.</h1>
      <p>Choose how much tBNB the agent may manage, set your objective and risk tolerance, then approve a revocable policy. MandateFi only trades when allocation moves outside your limits.</p>
      <button className="primary-button prominent" onClick={onCreate}>Create your first mandate <ArrowRight size={18} /></button>
      <div className="trust-row"><span><Fingerprint size={16} /> Passkey owner</span><span><LockKeyhole size={16} /> Scoped calls</span><span><ShieldCheck size={16} /> Instant revoke</span></div>
    </section>
    <aside className="empty-preview">
      <div className="preview-head"><span>Example policy</span><strong>Balanced growth</strong></div>
      <div className="preview-value"><span>Managed capital</span><strong>0.010 tBNB</strong><small>AI cannot access funds outside this scope</small></div>
      <AllocationBar stableBps={4500n} targetBps={4500n} compact />
      <div className="preview-policy-list"><div><Gauge size={16} /><span>Balanced risk</span><strong>45% BUSD target</strong></div><div><ArrowDownUp size={16} /><span>Rebalance band</span><strong>37%–53%</strong></div><div><Clock3 size={16} /><span>Policy duration</span><strong>14 days</strong></div></div>
    </aside>
    <div className="how-band">
      <div><b>1</b><span><strong>Define the capital</strong><small>Only the amount you choose enters the mandate.</small></span></div>
      <ChevronRight size={18} />
      <div><b>2</b><span><strong>Approve the guardrails</strong><small>Risk, protocols, spend caps and expiry are explicit.</small></span></div>
      <ChevronRight size={18} />
      <div><b>3</b><span><strong>Review every decision</strong><small>Each hold or trade includes rationale and evidence.</small></span></div>
    </div>
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
  const [step, setStep] = useState(1)
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

  useEffect(() => {
    if (step !== 3 || plan.action === 'HOLD') return
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

  return <div className="wizard-page">
    <div className="page-title-row wizard-title"><div><span className="eyebrow">New AI mandate</span><h1>Set the outcome. Bound the risk.</h1><p>The strategy can rebalance only the capital, contracts, spend limits and time window you approve.</p></div><button className="secondary-button" disabled={busy} onClick={onCancel}><X size={16} /> Cancel</button></div>
    <div className="wizard-layout">
      <aside className="wizard-steps">
        {[['Capital', 'Choose the managed amount'], ['Intent', 'Set goal and risk'], ['Plan', 'Review the AI allocation'], ['Approve', 'Create the onchain policy']].map(([title, copy], index) => {
          const number = index + 1
          return <button key={title} className={step === number ? 'active' : number < step ? 'complete' : ''} onClick={() => { if (number < step) setStep(number) }}><span>{number < step ? <Check size={15} /> : number}</span><div><strong>{title}</strong><small>{copy}</small></div></button>
        })}
        <div className="wizard-security"><ShieldCheck size={18} /><div><strong>Non-custodial by default</strong><span>Your passkey remains the admin. The AI receives a separate, revocable session key.</span></div></div>
      </aside>
      <section className="wizard-workspace">
        {step === 1 && <div className="wizard-section">
          <div className="section-title"><span>Step 1 of 4</span><h2>How much may the AI manage?</h2><p>This is a policy ceiling, not a transfer to MandateFi.</p></div>
          <label className="amount-field"><span>Managed capital</span><div><input type="number" min="0.001" max="0.05" step="0.001" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} /><b>tBNB</b></div><small className={!amountValid ? 'field-error' : ''}>{amountValid ? 'Minimum 0.001 tBNB. A 0.0015 tBNB gas reserve stays outside the managed scope.' : 'Enter an amount from 0.001 to 0.05 tBNB.'}</small></label>
          <div className="quick-values">{['0.003', '0.005', '0.008'].map((value) => <button key={value} className={draft.amount === value ? 'active' : ''} onClick={() => setDraft({ ...draft, amount: value })}>{value} tBNB</button>)}</div>
          <fieldset className="duration-field"><legend>Policy duration</legend><div>{[7, 14, 30].map((days) => <button type="button" key={days} className={draft.duration === days ? 'active' : ''} onClick={() => setDraft({ ...draft, duration: days })}><strong>{days} days</strong><small>{days === 7 ? 'Trial' : days === 14 ? 'Recommended' : 'Longer horizon'}</small></button>)}</div></fieldset>
          <div className="capital-summary"><CircleDollarSign size={19} /><div><span>Wallet capacity</span><strong>{altanaAddress ? `${altanaBalance} tBNB in smart wallet` : 'Created in the approval step'}</strong></div></div>
        </div>}
        {step === 2 && <div className="wizard-section">
          <div className="section-title"><span>Step 2 of 4</span><h2>What should the agent optimise for?</h2><p>Your objective adjusts the allocation target. Your risk level controls drift, trade size and slippage.</p></div>
          <fieldset className="choice-field"><legend>Primary objective</legend><div className="choice-grid goals">{goalOptions.map((goal) => <button type="button" key={goal.id} className={draft.goal === goal.id ? 'active' : ''} onClick={() => setDraft({ ...draft, goal: goal.id })}><span>{draft.goal === goal.id ? <Check size={14} /> : null}</span><strong>{goal.name}</strong><small>{goal.description}</small></button>)}</div></fieldset>
          <fieldset className="choice-field"><legend>Risk tolerance</legend><div className="choice-grid risks">{Object.values(riskProfiles).map((risk) => <button type="button" key={risk.id} className={draft.risk === risk.id ? 'active' : ''} onClick={() => setDraft({ ...draft, risk: risk.id })}><span>{draft.risk === risk.id ? <Check size={14} /> : null}</span><strong>{risk.name}</strong><small>{risk.description}</small><b>±{formatPercent(risk.driftBandBps)} drift</b></button>)}</div></fieldset>
        </div>}
        {step === 3 && <div className="wizard-section plan-section">
          <div className="section-title"><span>Step 3 of 4</span><h2>Review the generated allocation plan</h2><p>MandateFi converts your choices into deterministic policy parameters before any wallet approval.</p></div>
          <div className="plan-summary-grid">
            <div className="plan-allocation"><span>Target allocation</span><strong>{formatPercent(plan.targetStableBps)} BUSD</strong><AllocationBar stableBps={plan.currentStableBps} targetBps={plan.targetStableBps} compact /></div>
            <div className="plan-action"><span>Initial decision</span><strong>{actionLabel(plan.action)}</strong><p>{plan.rationale}</p></div>
          </div>
          <div className="execution-preview"><div className="execution-route"><span className="route-token">{plan.inputAsset}</span><div><ArrowRight size={19} /><small>PancakeSwap V2</small></div><span className="route-token output">{plan.outputAsset}</span></div><dl><div><dt>Input</dt><dd>{plan.action === 'HOLD' ? 'No transaction' : `${plan.inputAsset === 'tBNB' ? formatNative(plan.amountIn) : formatStable(plan.amountIn)} ${plan.inputAsset}`}</dd></div><div><dt>Live quote</dt><dd>{usableQuote ? `≈ ${usableQuote.outputSymbol === 'tBNB' ? formatNative(usableQuote.quotedOut) : formatStable(usableQuote.quotedOut)} ${usableQuote.outputSymbol}` : plan.action === 'HOLD' ? 'Not required' : snapshotLoading ? 'Loading…' : 'Refreshing…'}</dd></div><div><dt>Minimum received</dt><dd>{usableQuote ? `${usableQuote.outputSymbol === 'tBNB' ? formatNative(usableQuote.minimumOut) : formatStable(usableQuote.minimumOut)} ${usableQuote.outputSymbol}` : '—'}</dd></div></dl></div>
          {quoteError && <div className="inline-error"><AlertTriangle size={16} /> {quoteError}</div>}
          <div className="policy-grid"><div><ShieldCheck size={18} /><span>Allocation</span><strong>{formatPercent(plan.targetStableBps)} stable target</strong></div><div><Gauge size={18} /><span>Drift band</span><strong>±{formatPercent(plan.driftBandBps)}</strong></div><div><ArrowDownUp size={18} /><span>Daily cap</span><strong>{formatNative(plan.dailyNativeCap)} tBNB</strong></div><div><LockKeyhole size={18} /><span>Allowed calls</span><strong>PancakeSwap only</strong></div></div>
          <div className="policy-boundary"><BrainCircuit size={18} /><div><strong>Two enforcement layers</strong><span>The deterministic policy engine decides whether a rebalance is valid. Altana independently enforces contract allowlists, method scope, token caps and expiry onchain.</span></div></div>
        </div>}
        {step === 4 && <div className="wizard-section approval-section">
          <div className="section-title"><span>Step 4 of 4</span><h2>Approve the owner policy</h2><p>Complete each item once. Your passkey authorises the scoped AI session; it never leaves your device.</p></div>
          <div className="approval-layout">
            <div className="approval-checklist">
              <div className={account && isTargetNetwork ? 'complete' : ''}><span>{account && isTargetNetwork ? <Check size={16} /> : <Wallet size={16} />}</span><div><strong>Funding wallet</strong><small>{account ? `${shortAddress(account)} · ${isTargetNetwork ? 'BNB Testnet' : 'wrong network'}` : 'Connect an injected wallet'}</small></div>{!account ? <button onClick={onConnect}>Connect</button> : !isTargetNetwork ? <button onClick={onSwitchNetwork}>Switch</button> : null}</div>
              <div className={altanaAddress ? 'complete' : ''}><span>{altanaAddress ? <Check size={16} /> : <Fingerprint size={16} />}</span><div><strong>Passkey smart wallet</strong><small>{altanaAddress ? shortAddress(altanaAddress) : 'Owner-controlled account'}</small></div>{!altanaAddress && <div className="inline-actions"><button disabled={!isPasskeySupported || busy} onClick={onCreateAltana}>Create</button><button disabled={!isPasskeySupported || busy} onClick={onRecoverAltana}>Recover</button></div>}</div>
              <div className={altanaFunded ? 'complete' : ''}><span>{altanaFunded ? <Check size={16} /> : <Fuel size={16} />}</span><div><strong>Execution capital</strong><small>{altanaAddress ? `${altanaBalance} tBNB available` : 'Fund after wallet creation'}</small></div>{altanaAddress && !altanaFunded && <button disabled={busy} onClick={onFundAltana}>Fund 0.01</button>}</div>
            </div>
            <aside className="approval-recap"><span>Policy recap</span><h3>{goalOptions.find((goal) => goal.id === draft.goal)?.name}</h3><dl><div><dt>Managed amount</dt><dd>{draft.amount} tBNB</dd></div><div><dt>Risk</dt><dd>{riskProfiles[draft.risk].name}</dd></div><div><dt>Target</dt><dd>{formatPercent(plan.targetStableBps)} BUSD</dd></div><div><dt>Duration</dt><dd>{draft.duration} days</dd></div></dl><div className="recap-note"><KeyRound size={16} /> Revocable session key, separate from owner key</div></aside>
          </div>
          {busy && <div className="operation-status"><LoaderCircle className="spin" size={16} /> {starting ? 'Starting the mandate…' : altanaStageCopy[altanaStage]}</div>}
          {!isPasskeySupported && <div className="inline-error"><AlertTriangle size={16} /> This browser does not expose WebAuthn passkeys.</div>}
          {(walletError || altanaError) && <div className="inline-error"><AlertTriangle size={16} /> {walletError || altanaError}</div>}
        </div>}
        <footer className="wizard-footer"><button className="secondary-button" disabled={busy} onClick={() => step === 1 ? onCancel() : setStep(step - 1)}>{step === 1 ? 'Cancel' : 'Back'}</button>{step < 4 ? <button className="primary-button" disabled={(step === 1 && !amountValid) || (step === 3 && plan.action !== 'HOLD' && !usableQuote)} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={16} /></button> : <button className="primary-button start-button" disabled={!ready || busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={16} /> : <Fingerprint size={16} />} Approve and start</button>}</footer>
      </section>
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

  const currentNav = navItems.find((item) => item.id === view)

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand-block"><div className="brand-mark"><BarChart3 size={19} /></div><div><strong>MandateFi</strong><span>AI Asset Manager</span></div><button ref={mobileCloseButton} className="icon-button mobile-close" onClick={closeMobileMenu} aria-label="Close menu"><X size={19} /></button></div>
      <nav className="primary-nav">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); closeMobileMenu() }}><Icon size={18} /><span>{item.label}</span>{item.id === 'decisions' && mandates.some((mandate) => mandate.decisions.length) && <b>{mandates.reduce((sum, mandate) => sum + mandate.decisions.length, 0)}</b>}</button> })}</nav>
      <div className="sidebar-context"><span>Active mandate</span>{activeMandate ? <><strong>{activeMandate.name}</strong><small>{activeMandate.managedAmount} tBNB · {riskProfiles[activeMandate.riskProfile].name}</small><div className="mini-allocation"><i style={{ width: `${activeMandate.targetStableBps / 100}%` }} /></div><small>{activeMandate.targetStableBps / 100}% BUSD target</small></> : <><strong>None</strong><small>Create a bounded allocation policy.</small></>}</div>
      <div className="network-panel"><div><span><i className={wallet.isTargetNetwork ? 'online' : ''} /> BNB Testnet</span><strong>{wallet.isTargetNetwork ? 'Connected' : 'Target'}</strong></div><div><span><i className={altana.address ? 'online' : ''} /> Altana wallet</span><strong>{altana.address ? 'Ready' : 'Not created'}</strong></div><div><span><i className={snapshot ? 'online' : ''} /> PancakeSwap</span><strong>{snapshot ? 'Live' : 'Waiting'}</strong></div></div>
      <div className="sidebar-foot"><ShieldCheck size={18} /><div><strong>Owner remains in control</strong><span>Passkey admin, scoped session, expiry and onchain revoke.</span></div></div>
    </aside>
    <button className={`sidebar-scrim ${menuOpen ? 'visible' : ''}`} onClick={closeMobileMenu} aria-label="Close navigation" />
    <main className="main-area" inert={menuOpen ? true : undefined} aria-hidden={menuOpen ? true : undefined}>
      <header className="topbar"><button ref={mobileMenuButton} className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><span>MandateFi</span><ChevronRight size={14} /><strong>{currentNav?.label}</strong></div><div className="topbar-actions"><span className="testnet-badge">BSC Testnet</span><button className={wallet.isConnected ? 'wallet-button connected' : 'wallet-button'} disabled={wallet.status === 'connecting'} onClick={() => wallet.isConnected && !wallet.isTargetNetwork ? void wallet.switchNetwork() : !wallet.isConnected ? void wallet.connect() : undefined}><Wallet size={17} />{wallet.status === 'connecting' ? 'Connecting…' : wallet.account ? shortAddress(wallet.account) : 'Connect wallet'}</button></div></header>
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
