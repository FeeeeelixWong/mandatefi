import { useEffect, useMemo, useState } from 'react'
import {
  Activity, ArrowLeftRight, ArrowRight, BadgeCheck, Bot, Check, ChevronRight,
  CircleDollarSign, ExternalLink, Filter, Grid2X2, HeartPulse, Info, LayoutGrid,
  Fingerprint, Fuel, KeyRound, LoaderCircle, LockKeyhole, Menu, RefreshCw,
  Search, ShieldCheck, SlidersHorizontal, TrendingUp, Wallet, X, Zap,
} from 'lucide-react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { agents } from './data/agents'
import { use8004Registry } from './hooks/use8004Registry'
import { useAltanaWallet, type AltanaStage } from './hooks/useAltanaWallet'
import { useInjectedWallet } from './hooks/useInjectedWallet'
import { BSC_TESTNET_EXPLORER_URL } from './lib/chains'
import { shortAddress } from './lib/wallet'
import type { AltanaMandateProof, AltanaStrategyProof } from './integrations/altana'
import type { Agent, AgentCategory, Mandate } from './types'
import './App.css'

type View = 'marketplace' | 'compare' | 'mandates' | 'activity'
type CategoryFilter = 'All agents' | AgentCategory

const categories: Array<{ label: CategoryFilter; icon: typeof LayoutGrid }> = [
  { label: 'All agents', icon: LayoutGrid },
  { label: 'Rebalancing', icon: RefreshCw },
  { label: 'Grid Trading', icon: Grid2X2 },
  { label: 'Yield Optimisation', icon: TrendingUp },
  { label: 'Health Factor', icon: HeartPulse },
]

const categoryMeta: Record<AgentCategory, { icon: typeof Bot; tone: string }> = {
  Rebalancing: { icon: RefreshCw, tone: 'mint' },
  'Grid Trading': { icon: Grid2X2, tone: 'amber' },
  'Yield Optimisation': { icon: TrendingUp, tone: 'blue' },
  'Health Factor': { icon: HeartPulse, tone: 'coral' },
}

const activityRows = [
  { agent: 'Range Pilot', action: 'Rebalanced WBNB/USDT range', result: '+$18.42 projected fees', age: '18 sec' },
  { agent: 'Health Guard', action: 'Raised Venus health factor', result: '1.21 → 1.48', age: '1 min' },
  { agent: 'Yield Scout', action: 'Compared lending routes', result: 'No move · hurdle not met', age: '4 min' },
  { agent: 'Grid Smith', action: 'Filled grid order', result: '+$3.18 realized', age: '7 min' },
]

const mandateStorageKey = 'mandatefi.mandates.v1'

function loadMandates(): Mandate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(mandateStorageKey) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Mandate => Boolean(
      item && typeof item === 'object' &&
      typeof item.smartWallet === 'string' &&
      typeof item.sessionPublicKey === 'string' &&
      typeof item.expiry === 'number',
    ))
  } catch {
    return []
  }
}

function altanaExplorerTx(hash?: `0x${string}`) {
  return hash ? `${BSC_TESTNET_EXPLORER_URL}/tx/${hash}` : null
}

const altanaStageCopy: Record<AltanaStage, string> = {
  idle: 'Ready',
  creating: 'Creating passkey wallet…',
  recovering: 'Recovering passkey wallet…',
  funding: 'Waiting for funding transaction…',
  granting: 'Registering session in Altana KeyStore…',
  executing: 'Executing the session-scoped onchain action…',
  revoking: 'Revoking session onchain…',
  error: 'Action required',
}

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const data = values.map((value, index) => ({ index, value }))
  return (
    <ResponsiveContainer width="100%" height={48}>
      <LineChart data={data} margin={{ top: 5, right: 2, left: 2, bottom: 2 }}>
        <Line type="monotone" dataKey="value" stroke={`var(--${tone})`} strokeWidth={2.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function RiskBadge({ risk }: { risk: Agent['risk'] }) {
  return <span className={`risk-badge risk-${risk.toLowerCase()}`}>{risk} risk</span>
}

function AgentCard({ agent, compared, onCompare, onOpen, onActivate }: {
  agent: Agent; compared: boolean; onCompare: () => void; onOpen: () => void; onActivate: () => void
}) {
  const meta = categoryMeta[agent.category]
  const CategoryIcon = meta.icon
  return (
    <article className="agent-card">
      <div className="agent-card-head">
        <button className={`agent-mark ${meta.tone}`} onClick={onOpen} aria-label={`Open ${agent.name}`}><CategoryIcon size={20} /></button>
        <div className="agent-title-block">
          <button className="agent-name" onClick={onOpen}>{agent.name}</button>
          <span className="agent-category">{agent.category}</span>
        </div>
        <button className={`icon-button compare-button ${compared ? 'is-selected' : ''}`} onClick={onCompare} title={compared ? 'Remove from comparison' : 'Add to comparison'} aria-label={compared ? 'Remove from comparison' : 'Add to comparison'}>
          {compared ? <Check size={17} /> : <ArrowLeftRight size={17} />}
        </button>
      </div>
      <p className="agent-tagline">{agent.tagline}</p>
      <div className="agent-proof-row">
        <span className="verified-label"><BadgeCheck size={15} /> {agent.strategyMode ? 'Live Testnet strategy' : 'ERC-8004-ready demo'}</span>
        <RiskBadge risk={agent.risk} />
      </div>
      <div className="performance-panel">
        <div><span>{agent.primaryMetric.label}</span><strong>{agent.primaryMetric.value}</strong><small>{agent.primaryMetric.hint}</small></div>
        <div className="sparkline-wrap" aria-label={`${agent.name} performance trend`}><Sparkline values={agent.sparkline} tone={meta.tone} /></div>
      </div>
      <dl className="metric-grid">
        {agent.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd><small>{metric.hint}</small></div>)}
      </dl>
      <div className="agent-meta">
        <span><CircleDollarSign size={14} /> {agent.fee}</span>
        <span><Bot size={14} /> {agent.activeMandates} active</span>
      </div>
      <div className="agent-card-actions">
        <button className="secondary-button" onClick={onOpen}>View evidence</button>
        <button className="primary-button" onClick={onActivate}>Activate <ArrowRight size={16} /></button>
      </div>
    </article>
  )
}

function DetailDrawer({ agent, onClose, onActivate }: { agent: Agent; onClose: () => void; onActivate: () => void }) {
  const meta = categoryMeta[agent.category]
  const CategoryIcon = meta.icon
  return (
    <div className="drawer-scrim" onMouseDown={onClose}>
      <aside className="detail-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div className={`agent-mark ${meta.tone}`}><CategoryIcon size={22} /></div>
          <div><span className="eyebrow">{agent.category}</span><h2>{agent.name}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close details"><X size={19} /></button>
        </div>
        <div className="drawer-content">
          <div className="identity-strip">
            <div><BadgeCheck size={17} /><span>Identity preview</span><strong>{agent.identity}</strong></div>
            <div><Zap size={17} /><span>Execution</span><strong>{agent.strategyMode ? 'Live on BSC Testnet' : 'Integration queued'}</strong></div>
          </div>
          <section className="drawer-section"><h3>What it does</h3><p>{agent.description}</p></section>
          <section className="drawer-section">
            <div className="section-heading-row"><h3>Evidence</h3><span>Updated {agent.updated}</span></div>
            <div className="evidence-grid">
              <div><span>{agent.primaryMetric.label}</span><strong>{agent.primaryMetric.value}</strong><small>{agent.primaryMetric.hint}</small></div>
              <div><span>Execution success</span><strong>{agent.successRate}%</strong><small>scenario dataset</small></div>
              <div><span>Managed value</span><strong>{agent.managedValue}</strong><small>scenario dataset</small></div>
              <div><span>Active mandates</span><strong>{agent.activeMandates}</strong><small>scenario dataset</small></div>
            </div>
          </section>
          <section className="drawer-section"><h3>Owner safeguards</h3><ul className="safeguard-list">{agent.safeguards.map((item) => <li key={item}><ShieldCheck size={16} /> {item}</li>)}</ul></section>
          <section className="drawer-section"><h3>Allowed protocols</h3><div className="protocol-list">{agent.protocols.map((protocol) => <span key={protocol}>{protocol}</span>)}</div></section>
        </div>
        <div className="drawer-footer"><div><span>Service fee</span><strong>{agent.fee}</strong></div><button className="primary-button large" onClick={onActivate}>Set mandate <ArrowRight size={17} /></button></div>
      </aside>
    </div>
  )
}

function ActivationModal({
  agent, account, balance, isTargetNetwork, walletError, altanaAddress,
  altanaBalance, altanaFunded, altanaStage, altanaError, isPasskeySupported,
  onConnect, onSwitchNetwork, onCreateAltana, onRecoverAltana, onFundAltana,
  onClose, onConfirm,
}: {
  agent: Agent
  account: `0x${string}` | null
  balance: string | null
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
  onClose: () => void
  onConfirm: (budget: number, duration: number, protocols: string[]) => Promise<void>
}) {
  const [step, setStep] = useState(1)
  const [budget, setBudget] = useState(250)
  const [duration, setDuration] = useState(7)
  const [protocols, setProtocols] = useState(agent.protocols)
  const [strategyQuote, setStrategyQuote] = useState<{ expected: string; minimum: string } | null>(null)
  const [quoteError, setQuoteError] = useState('')
  const isSafeRebalance = agent.strategyMode === 'safe-rebalance'
  useEffect(() => {
    if (!isSafeRebalance) return
    let active = true
    void import('./integrations/altana').then(async ({ formatStrategyToken, quoteSafeRebalance }) => {
      const quote = await quoteSafeRebalance()
      if (active) setStrategyQuote({
        expected: formatStrategyToken(quote.quotedOut),
        minimum: formatStrategyToken(quote.minimumOut),
      })
    }).catch((error: unknown) => {
      if (active) setQuoteError(error instanceof Error ? error.message : 'Live quote unavailable.')
    })
    return () => { active = false }
  }, [isSafeRebalance])
  function toggleProtocol(protocol: string) {
    setProtocols((current) => current.includes(protocol) ? current.filter((item) => item !== protocol) : [...current, protocol])
  }
  const altanaBusy = !['idle', 'error'].includes(altanaStage)
  const readyToRegister = Boolean(account && isTargetNetwork && altanaAddress && altanaFunded)
  return (
    <div className="modal-scrim" onMouseDown={() => { if (!altanaBusy) onClose() }}>
      <div className="activation-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><span className="eyebrow">Activate {agent.name}</span><h2>{step === 1 ? 'Define the mandate' : step === 2 ? 'Review authority' : 'Ready to register'}</h2></div><button className="icon-button" disabled={altanaBusy} onClick={onClose} aria-label="Close activation"><X size={19} /></button></div>
        <div className="stepper" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((item) => <span key={item} className={item <= step ? 'active' : ''}>{item < step ? <Check size={14} /> : item}</span>)}</div>
        {step === 1 && <div className="modal-body">
          {isSafeRebalance ? <div className="strategy-preview">
            <div className="strategy-preview-head"><span>Live Testnet strategy</span><strong>Safe Treasury Rebalance</strong></div>
            <div className="strategy-swap"><strong>0.001 tBNB</strong><ArrowRight size={18} /><strong>{strategyQuote ? `≈ ${strategyQuote.expected} BUSD` : 'Fetching BUSD quote…'}</strong></div>
            <div className="strategy-guards"><span>1% max slippage</span><span>10 min deadline</span><span>Smart-wallet recipient</span></div>
            {quoteError && <small className="wallet-error">{quoteError}</small>}
          </div> : <label className="field-label">Strategy capital policy<div className="money-input"><span>$</span><input type="number" min="10" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div><small>Recorded as the strategy-level budget for this catalog mandate.</small></label>}
          <label className="field-label">Permission expires<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={1}>After 24 hours</option><option value={7}>After 7 days</option><option value={30}>After 30 days</option></select></label>
          <fieldset className="protocol-fieldset"><legend>Strategy protocol policy</legend>{agent.protocols.map((protocol) => <label key={protocol}><input type="checkbox" checked={protocols.includes(protocol)} disabled={isSafeRebalance} onChange={() => toggleProtocol(protocol)} /><span><Check size={14} /></span>{protocol}</label>)}</fieldset>
          <div className="callout"><LockKeyhole size={18} /><span>Your wallet keeps custody. The agent receives only scoped, revocable authority.</span></div>
        </div>}
        {step === 2 && <div className="modal-body">
          <div className="review-list"><div><span>Agent</span><strong>{agent.name}</strong></div><div><span>{isSafeRebalance ? 'Execution amount' : 'Strategy budget'}</span><strong>{isSafeRebalance ? '0.001 tBNB' : `$${budget.toLocaleString()}`}</strong></div>{isSafeRebalance && <div><span>Minimum received</span><strong>{strategyQuote ? `${strategyQuote.minimum} BUSD` : 'Refreshing at execution'}</strong></div>}<div><span>Expiry</span><strong>{duration} day{duration > 1 ? 's' : ''}</strong></div><div><span>Protocol policy</span><strong>{protocols.join(', ')}</strong></div><div><span>Network</span><strong>BNB Smart Chain Testnet</strong></div></div>
          {isSafeRebalance ? <div className="simulation-result live"><ShieldCheck size={22} /><div><strong>Bounded execution scope</strong><span>Altana enforces one PancakeSwap V2 router and one swap method, a 0.004 tBNB daily native cap, and expiry. MandateFi refreshes the quote immediately before execution, pins the tBNB→BUSD path and smart-wallet recipient, and rejects output below 99% of quote.</span></div></div> : <div className="simulation-result"><ShieldCheck size={22} /><div><strong>Verification-only scope</strong><span>This catalog agent receives only the zero-value Altana KeyStore verification method. It cannot call a strategy protocol or move assets.</span></div></div>}
        </div>}
        {step === 3 && <div className="modal-body final-step">
          <div className="final-icon"><Fingerprint size={30} /></div>
          <h3>{isSafeRebalance ? 'Authorize the bounded swap' : 'Prepare the onchain owner account'}</h3>
          <p>{isSafeRebalance ? 'Your passkey registers the scoped Altana session. The generated session then executes one 0.001 tBNB PancakeSwap transaction and records the receipt.' : 'The injected wallet supplies test gas. A device passkey controls the Altana smart wallet and authorizes every grant or revoke.'}</p>
          <div className="setup-checklist">
            <div className={account && isTargetNetwork ? 'complete' : ''}><span>{account && isTargetNetwork ? <Check size={15} /> : <Wallet size={15} />}</span><div><strong>Funding wallet</strong><small>{account ? `${shortAddress(account)} · ${isTargetNetwork ? 'BSC Testnet' : 'wrong network'}` : 'Not connected'}</small></div></div>
            <div className={altanaAddress ? 'complete' : ''}><span>{altanaAddress ? <Check size={15} /> : <KeyRound size={15} />}</span><div><strong>Passkey smart wallet</strong><small>{altanaAddress ? shortAddress(altanaAddress) : 'Not created'}</small></div></div>
            <div className={altanaFunded ? 'complete' : ''}><span>{altanaFunded ? <Check size={15} /> : <Fuel size={15} />}</span><div><strong>Execution balance</strong><small>{altanaAddress ? `${altanaBalance} tBNB` : 'Fund after creation'}</small></div></div>
          </div>
          {account && <div className="wallet-proof"><span>Funding wallet</span><strong>{shortAddress(account)}</strong><span>Balance</span><strong>{balance === null ? 'Reading…' : `${balance} tBNB`}</strong>{altanaAddress && <><span>Altana wallet</span><strong title={altanaAddress}>{shortAddress(altanaAddress)}</strong></>}</div>}
          {!account ? <button className="wallet-connect-large" onClick={onConnect}><Wallet size={18} /> Connect wallet</button>
            : !isTargetNetwork ? <button className="wallet-connect-large" onClick={onSwitchNetwork}><RefreshCw size={18} /> Switch network</button>
              : !altanaAddress ? <div className="passkey-actions"><button className="wallet-connect-large" disabled={!isPasskeySupported || altanaBusy} onClick={onCreateAltana}>{altanaStage === 'creating' ? <LoaderCircle className="spin" size={18} /> : <Fingerprint size={18} />} Create passkey wallet</button><button className="text-button" disabled={!isPasskeySupported || altanaBusy} onClick={onRecoverAltana}>Recover existing wallet</button></div>
                : !altanaFunded ? <button className="wallet-connect-large" disabled={altanaBusy} onClick={onFundAltana}>{altanaStage === 'funding' ? <LoaderCircle className="spin" size={18} /> : <Fuel size={18} />} Fund 0.01 tBNB</button> : null}
          {altanaBusy && <div className="operation-status"><LoaderCircle className="spin" size={16} /> {altanaStageCopy[altanaStage]}</div>}
          {!isPasskeySupported && <span className="wallet-error">This browser does not expose WebAuthn passkeys.</span>}
          {(walletError || altanaError) && <span className="wallet-error">{walletError || altanaError}</span>}
        </div>}
        <div className="modal-footer">{step > 1 ? <button className="secondary-button" disabled={altanaBusy} onClick={() => setStep(step - 1)}>Back</button> : <span />}{step < 3 ? <button className="primary-button large" disabled={(step === 1 && protocols.length === 0) || (isSafeRebalance && !strategyQuote)} onClick={() => setStep(step + 1)}>Continue <ChevronRight size={17} /></button> : <button className="primary-button large" disabled={!readyToRegister || altanaBusy} onClick={() => void onConfirm(isSafeRebalance ? 0.001 : budget, duration, protocols)}>{altanaBusy ? <LoaderCircle className="spin" size={16} /> : <KeyRound size={16} />} {altanaBusy ? altanaStageCopy[altanaStage] : isSafeRebalance ? 'Authorize & execute' : 'Register onchain'}</button>}</div>
      </div>
    </div>
  )
}

function CompareView({ selected, onOpen, onClear }: { selected: Agent[]; onOpen: (agent: Agent) => void; onClear: () => void }) {
  if (selected.length < 2) return <div className="empty-state"><div className="empty-icon"><ArrowLeftRight size={26} /></div><h2>Compare agents side by side</h2><p>Select at least two agents from the marketplace to compare simulated outcomes, risk, fees, and safeguards.</p></div>
  return <div className="compare-view">
    <div className="view-title-row"><div><span className="eyebrow">Decision workspace</span><h1>Compare agents</h1></div><button className="secondary-button" onClick={onClear}>Clear comparison</button></div>
    <div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>Metric</th>{selected.map((agent) => <th key={agent.id}><button onClick={() => onOpen(agent)}>{agent.name}</button><small>{agent.category}</small></th>)}</tr></thead><tbody>
      <tr><th>Primary outcome</th>{selected.map((agent) => <td key={agent.id}><strong>{agent.primaryMetric.value}</strong><span>{agent.primaryMetric.label}</span></td>)}</tr>
      <tr><th>Risk</th>{selected.map((agent) => <td key={agent.id}><RiskBadge risk={agent.risk} /></td>)}</tr>
      <tr><th>Success rate</th>{selected.map((agent) => <td key={agent.id}><strong>{agent.successRate}%</strong><span>scenario dataset</span></td>)}</tr>
      <tr><th>Managed value</th>{selected.map((agent) => <td key={agent.id}><strong>{agent.managedValue}</strong><span>scenario dataset</span></td>)}</tr>
      <tr><th>Service fee</th>{selected.map((agent) => <td key={agent.id}><strong>{agent.fee}</strong></td>)}</tr>
      <tr><th>Protocols</th>{selected.map((agent) => <td key={agent.id}>{agent.protocols.join(', ')}</td>)}</tr>
    </tbody></table></div>
  </div>
}

function MandatesView({ mandates, revokingId, onRevoke }: { mandates: Mandate[]; revokingId: string; onRevoke: (id: string) => void }) {
  return <div><div className="view-title-row"><div><span className="eyebrow">Owner control</span><h1>My mandates</h1></div><span className="live-status"><i className="online" /> Altana onchain</span></div>{mandates.length === 0 ? <div className="empty-state"><div className="empty-icon"><ShieldCheck size={26} /></div><h2>No onchain mandates</h2><p>Activate an agent to register a public, scoped Altana session on BSC Testnet.</p></div> : <div className="mandate-list">{mandates.map((mandate) => {
    const executionState = mandate.strategyState ?? mandate.verificationState ?? (mandate.strategyTxHash || mandate.verificationTxHash ? 'CONFIRMED' : 'UNAVAILABLE')
    return <article key={mandate.id} className="mandate-row-wrap"><div className="mandate-row"><div className="mandate-icon"><Bot size={20} /></div><div className="mandate-main"><strong>{mandate.agentName}</strong><span>{mandate.protocols.join(' · ')}</span></div><div><span>{mandate.strategyId ? 'Testnet execution' : 'Strategy budget'}</span><strong>{mandate.strategyId ? `${mandate.inputAmount} ${mandate.inputAsset}` : `$${mandate.budget.toLocaleString()}`}</strong></div><div><span>Expires</span><strong>{new Date(mandate.expiry * 1000).toLocaleDateString()}</strong></div><div><span>Status</span><strong className={mandate.status === 'Active' ? 'status-active' : 'status-revoked'}>{mandate.status}</strong></div><button className="danger-button" disabled={mandate.status === 'Revoked' || revokingId === mandate.id} onClick={() => onRevoke(mandate.id)}>{revokingId === mandate.id ? <LoaderCircle className="spin" size={14} /> : null}{revokingId === mandate.id ? 'Revoking' : 'Revoke'}</button></div><div className="mandate-evidence"><span><KeyRound size={14} /> Smart wallet {shortAddress(mandate.smartWallet)} · {mandate.strategyId ? `received ${mandate.outputReceived ?? 'pending'} ${mandate.outputAsset ?? 'BUSD'}` : `verification ${executionState.toLowerCase()}`}</span>{mandate.grantTxHash && <a href={altanaExplorerTx(mandate.grantTxHash) ?? '#'} target="_blank" rel="noreferrer">Grant tx <ExternalLink size={12} /></a>}{mandate.strategyTxHash && <a href={altanaExplorerTx(mandate.strategyTxHash) ?? '#'} target="_blank" rel="noreferrer">Swap tx <ExternalLink size={12} /></a>}{mandate.verificationTxHash && <a href={altanaExplorerTx(mandate.verificationTxHash) ?? '#'} target="_blank" rel="noreferrer">Session execution <ExternalLink size={12} /></a>}{mandate.revokeTxHash && <a href={altanaExplorerTx(mandate.revokeTxHash) ?? '#'} target="_blank" rel="noreferrer">Revoke tx <ExternalLink size={12} /></a>}</div></article>
  })}</div>}</div>
}

function ActivityView() {
  return <div><div className="view-title-row"><div><span className="eyebrow">Scenario evidence</span><h1>Activity preview</h1></div><span className="live-status"><i /> Demo data</span></div><div className="activity-table-wrap"><table className="activity-table"><thead><tr><th>Agent</th><th>Action</th><th>Simulated result</th><th>Age</th><th /></tr></thead><tbody>{activityRows.map((row) => <tr key={`${row.agent}-${row.age}`}><td><strong>{row.agent}</strong></td><td>{row.action}</td><td><span className="result-text">{row.result}</span></td><td>{row.age}</td><td><button className="icon-button" title="Transaction evidence will be linked after BSC integration" disabled><ExternalLink size={16} /></button></td></tr>)}</tbody></table></div></div>
}

function App() {
  const [view, setView] = useState<View>('marketplace')
  const [category, setCategory] = useState<CategoryFilter>('All agents')
  const [search, setSearch] = useState('')
  const [comparedIds, setComparedIds] = useState<string[]>([])
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [activationAgent, setActivationAgent] = useState<Agent | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mandates, setMandates] = useState<Mandate[]>(loadMandates)
  const [revokingId, setRevokingId] = useState('')
  const [notice, setNotice] = useState('')
  const wallet = useInjectedWallet()
  const altana = useAltanaWallet()
  const registry = use8004Registry()

  useEffect(() => {
    localStorage.setItem(mandateStorageKey, JSON.stringify(mandates))
  }, [mandates])

  const filteredAgents = useMemo(() => agents.filter((agent) => {
    const categoryMatch = category === 'All agents' || agent.category === category
    const query = search.trim().toLowerCase()
    const searchMatch = !query || [agent.name, agent.tagline, agent.category, ...agent.protocols].join(' ').toLowerCase().includes(query)
    return categoryMatch && searchMatch
  }), [category, search])
  const comparedAgents = agents.filter((agent) => comparedIds.includes(agent.id))

  function toggleCompare(id: string) {
    setComparedIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id)
      if (current.length >= 3) { setNotice('You can compare up to three agents at once.'); return current }
      return [...current, id]
    })
  }

  async function confirmMandate(budget: number, duration: number, protocols: string[]) {
    if (!activationAgent) return
    try {
      const strategyId = activationAgent.strategyMode
      const proof = await altana.activate(duration, strategyId)
      const strategyProof = strategyId ? proof as AltanaStrategyProof : null
      const verificationProof = strategyId ? null : proof as AltanaMandateProof
      const { formatStrategyToken } = await import('./integrations/altana')
      setMandates((current) => [{
        id: crypto.randomUUID(),
        agentId: activationAgent.id,
        agentName: activationAgent.name,
        budget,
        duration,
        protocols,
        status: 'Active',
        createdAt: new Date().toISOString(),
        chainId: 97,
        smartWallet: proof.session.walletAddress,
        sessionPublicKey: proof.session.publicKey,
        expiry: proof.session.expiry,
        grantTxHash: proof.grant.transactionHash,
        verificationTxHash: verificationProof?.verification?.transactionHash,
        verificationState: verificationProof?.verification?.status ?? (strategyProof ? undefined : 'UNAVAILABLE'),
        verificationError: verificationProof?.verificationError,
        strategyId,
        strategyTxHash: strategyProof?.execution?.transactionHash,
        strategyState: strategyProof?.execution?.status ?? (strategyProof ? 'UNAVAILABLE' : undefined),
        strategyError: strategyProof?.executionError,
        inputAmount: strategyProof ? formatStrategyToken(strategyProof.quote.amountIn) : undefined,
        inputAsset: strategyProof ? 'tBNB' : undefined,
        quotedOutput: strategyProof ? formatStrategyToken(strategyProof.quote.quotedOut) : undefined,
        minimumOutput: strategyProof ? formatStrategyToken(strategyProof.quote.minimumOut) : undefined,
        outputReceived: strategyProof?.outputReceived !== undefined ? formatStrategyToken(strategyProof.outputReceived) : undefined,
        outputAsset: strategyProof ? strategyProof.quote.outputSymbol : undefined,
      }, ...current])
      setActivationAgent(null)
      setSelectedAgent(null)
      setNotice(strategyProof?.execution?.status === 'CONFIRMED'
        ? `${activationAgent.name} executed the bounded PancakeSwap rebalance on BSC Testnet.`
        : verificationProof?.verification?.status === 'CONFIRMED'
          ? `${activationAgent.name} session registered and verified on BSC Testnet.`
          : `${activationAgent.name} session registered. Execution evidence is unavailable; the mandate remains revocable.`)
      setView('mandates')
    } catch {
      // The hook keeps the detailed, user-visible failure state in the modal.
    }
  }

  async function revokeMandate(id: string) {
    const mandate = mandates.find((item) => item.id === id)
    if (!mandate) return
    setRevokingId(id)
    try {
      const result = await altana.revoke(mandate.sessionPublicKey)
      if (result.status === 'FAILED') throw new Error('Altana reported a failed revoke transaction.')
      setMandates((current) => current.map((item) => item.id === id ? { ...item, status: 'Revoked', revokeTxHash: result.transactionHash } : item))
      setNotice(`${mandate.agentName} session revoked on BSC Testnet.`)
    } catch {
      // The Altana hook exposes the exact error in the global toast.
    } finally {
      setRevokingId('')
    }
  }

  async function fundAltanaWallet() {
    if (!wallet.provider || !wallet.account) return
    try {
      await altana.fund(wallet.provider, wallet.account)
      await wallet.refresh()
      setNotice('Altana smart wallet funded with 0.01 tBNB.')
    } catch {
      // Errors are presented by the Altana hook.
    }
  }

  const navItems: Array<{ id: View; label: string; icon: typeof Bot }> = [
    { id: 'marketplace', label: 'Marketplace', icon: LayoutGrid }, { id: 'compare', label: 'Compare', icon: ArrowLeftRight },
    { id: 'mandates', label: 'My mandates', icon: ShieldCheck }, { id: 'activity', label: 'Activity preview', icon: Activity },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand-block"><div className="brand-mark">M</div><div><strong>MandateFi</strong><span>BNB Agent Market</span></div><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
      <nav className="primary-nav">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setMenuOpen(false) }}><Icon size={18} /><span>{item.label}</span>{item.id === 'compare' && comparedIds.length > 0 && <b>{comparedIds.length}</b>}</button> })}</nav>
      <div className="network-panel"><div className="network-row"><span><i className={wallet.isTargetNetwork ? 'online' : ''} /> BNB Smart Chain</span><strong>{wallet.isTargetNetwork ? 'Testnet connected' : 'Testnet target'}</strong></div><div className="network-row"><span>8004scan</span><strong>{registry.snapshot ? 'Live' : registry.loading ? 'Connecting' : 'Unavailable'}</strong></div><div className="network-row"><span>Altana sessions</span><strong>{altana.address ? 'Wallet ready' : 'Passkey ready'}</strong></div></div>
      <div className="sidebar-foot"><ShieldCheck size={18} /><div><strong>Bounded by design</strong><span>Every onchain session has scoped calls, expiry, and owner revoke.</span></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open menu"><Menu size={20} /></button><div className="breadcrumb"><span>MandateFi</span><ChevronRight size={14} /><strong>{navItems.find((item) => item.id === view)?.label}</strong></div><div className="topbar-actions"><span className="prototype-badge">Prototype</span><button className="icon-button" title="Strategy outcomes are scenario data; wallet and 8004scan connections are live"><Info size={18} /></button><button className={wallet.isConnected ? 'wallet-button connected' : 'wallet-button'} disabled={wallet.status === 'connecting'} onClick={() => wallet.isConnected && !wallet.isTargetNetwork ? void wallet.switchNetwork() : !wallet.isConnected ? void wallet.connect() : undefined} title={wallet.isConnected && !wallet.isTargetNetwork ? 'Switch to BNB Smart Chain Testnet' : wallet.account ?? 'Connect an injected EVM wallet'}><Wallet size={17} />{wallet.status === 'connecting' ? 'Connecting…' : wallet.account ? shortAddress(wallet.account) : 'Connect wallet'}</button></div></header>
      <div className="page-content">
        {view === 'marketplace' && <>
          <section className="market-heading"><div><span className="eyebrow">BNB Smart Money Era prototype</span><h1>Find the right DeFi agent.<br />Set the limits yourself.</h1><p>Compare four strategy types, then preview a bounded mandate with a spend cap, allowlist, expiry, and revoke control.</p></div><div className="market-stats"><div><span>BNB agent identities</span><strong>{registry.snapshot ? registry.snapshot.total.toLocaleString() : '—'}</strong><small>{registry.snapshot ? 'live from 8004scan' : 'registry connection pending'}</small></div><div><span>Strategy types</span><strong>4</strong><small>equal marketplace depth</small></div><div><span>Owner controls</span><strong>4</strong><small>cap · allowlist · expiry · revoke</small></div></div></section>
          {registry.snapshot && <section className="registry-strip"><div><BadgeCheck size={17} /><span><strong>Live ERC-8004 registry</strong><small>Latest BNB identities, separate from the scenario strategy catalog</small></span></div><div className="registry-agent-list">{registry.snapshot.agents.slice(0, 3).map((agent) => <span key={agent.token_id}>{agent.name || `Agent #${agent.token_id}`} <b>#{agent.token_id}</b></span>)}</div><a href="https://8004scan.io/agents" target="_blank" rel="noreferrer">Open 8004scan <ExternalLink size={13} /></a></section>}
          <section className="category-strip" aria-label="Agent categories">{categories.map((item) => { const Icon = item.icon; const count = item.label === 'All agents' ? agents.length : agents.filter((agent) => agent.category === item.label).length; return <button key={item.label} className={category === item.label ? 'active' : ''} onClick={() => setCategory(item.label)}><Icon size={17} /><span>{item.label}</span><b>{count}</b></button> })}</section>
          <div className="toolbar"><label className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search agents or protocols" /></label><div className="toolbar-right"><span className="freshness"><i className={registry.snapshot ? 'online' : ''} /> {registry.snapshot ? '8004scan live · strategy outcomes simulated' : registry.loading ? 'Connecting to 8004scan…' : 'Scenario catalog · registry unavailable'}</span><button className="tool-button"><Filter size={16} /> Filters</button><button className="icon-button" title="Sort agents"><SlidersHorizontal size={17} /></button></div></div>
          <div className="results-row"><span>{filteredAgents.length} demo agents</span><span>Sorted by risk-adjusted outcome</span></div>
          <section className="agent-grid">{filteredAgents.map((agent) => <AgentCard key={agent.id} agent={agent} compared={comparedIds.includes(agent.id)} onCompare={() => toggleCompare(agent.id)} onOpen={() => setSelectedAgent(agent)} onActivate={() => setActivationAgent(agent)} />)}</section>
          {filteredAgents.length === 0 && <div className="empty-state compact"><Search size={26} /><h2>No matching agents</h2><p>Try a protocol name or clear the current category.</p></div>}
        </>}
        {view === 'compare' && <CompareView selected={comparedAgents} onOpen={setSelectedAgent} onClear={() => setComparedIds([])} />}
        {view === 'mandates' && <MandatesView mandates={mandates} revokingId={revokingId} onRevoke={(id) => void revokeMandate(id)} />}
        {view === 'activity' && <ActivityView />}
      </div>
    </main>
    {comparedIds.length > 0 && view === 'marketplace' && <div className="compare-tray"><div><ArrowLeftRight size={18} /><strong>{comparedIds.length} selected</strong><span>{comparedAgents.map((agent) => agent.name).join(' · ')}</span></div><button className="primary-button" disabled={comparedIds.length < 2} onClick={() => setView('compare')}>Compare now <ArrowRight size={16} /></button></div>}
    {selectedAgent && <DetailDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} onActivate={() => { setActivationAgent(selectedAgent); setSelectedAgent(null) }} />}
    {activationAgent && <ActivationModal agent={activationAgent} account={wallet.account} balance={wallet.balance} isTargetNetwork={wallet.isTargetNetwork} walletError={wallet.error} altanaAddress={altana.address} altanaBalance={altana.balance} altanaFunded={altana.hasMinimumBalance} altanaStage={altana.stage} altanaError={altana.error} isPasskeySupported={altana.isPasskeySupported} onConnect={() => void wallet.connect()} onSwitchNetwork={() => void wallet.switchNetwork()} onCreateAltana={() => void altana.create().catch(() => undefined)} onRecoverAltana={() => void altana.recover().catch(() => undefined)} onFundAltana={() => void fundAltanaWallet()} onClose={() => { setActivationAgent(null); wallet.clearError(); altana.clearError() }} onConfirm={confirmMandate} />}
    {notice && <div className="toast"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {wallet.error && !activationAgent && <div className="toast error-toast"><Info size={17} /><span>{wallet.error}</span><button onClick={wallet.clearError} aria-label="Dismiss wallet error"><X size={15} /></button></div>}
    {altana.error && !activationAgent && <div className="toast error-toast"><Info size={17} /><span>{altana.error}</span><button onClick={altana.clearError} aria-label="Dismiss Altana error"><X size={15} /></button></div>}
  </div>
}

export default App
