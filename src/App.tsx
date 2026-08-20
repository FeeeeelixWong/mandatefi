import { useMemo, useState } from 'react'
import {
  Activity, ArrowLeftRight, ArrowRight, BadgeCheck, Bot, Check, ChevronRight,
  CircleDollarSign, ExternalLink, Filter, Grid2X2, HeartPulse, Info, LayoutGrid,
  LockKeyhole, Menu, RefreshCw, Search, ShieldCheck, SlidersHorizontal,
  TrendingUp, Wallet, X, Zap,
} from 'lucide-react'
import { Line, LineChart, ResponsiveContainer } from 'recharts'
import { agents } from './data/agents'
import { use8004Registry } from './hooks/use8004Registry'
import { useInjectedWallet } from './hooks/useInjectedWallet'
import { shortAddress } from './lib/wallet'
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
        <span className="verified-label"><BadgeCheck size={15} /> ERC-8004-ready demo</span>
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
            <div><Zap size={17} /><span>Agent Studio</span><strong>Integration queued</strong></div>
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

function ActivationModal({ agent, account, balance, isTargetNetwork, walletError, onConnect, onSwitchNetwork, onClose, onConfirm }: {
  agent: Agent
  account: `0x${string}` | null
  balance: string | null
  isTargetNetwork: boolean
  walletError: string
  onConnect: () => void
  onSwitchNetwork: () => void
  onClose: () => void
  onConfirm: (budget: number, duration: number, protocols: string[]) => void
}) {
  const [step, setStep] = useState(1)
  const [budget, setBudget] = useState(250)
  const [duration, setDuration] = useState(7)
  const [protocols, setProtocols] = useState(agent.protocols)
  function toggleProtocol(protocol: string) {
    setProtocols((current) => current.includes(protocol) ? current.filter((item) => item !== protocol) : [...current, protocol])
  }
  return (
    <div className="modal-scrim" onMouseDown={onClose}>
      <div className="activation-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><span className="eyebrow">Activate {agent.name}</span><h2>{step === 1 ? 'Define the mandate' : step === 2 ? 'Review authority' : 'Ready to register'}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close activation"><X size={19} /></button></div>
        <div className="stepper" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((item) => <span key={item} className={item <= step ? 'active' : ''}>{item < step ? <Check size={14} /> : item}</span>)}</div>
        {step === 1 && <div className="modal-body">
          <label className="field-label">Maximum capital<div className="money-input"><span>$</span><input type="number" min="10" value={budget} onChange={(event) => setBudget(Number(event.target.value))} /></div><small>The session key cannot move more than this amount.</small></label>
          <label className="field-label">Permission expires<select value={duration} onChange={(event) => setDuration(Number(event.target.value))}><option value={1}>After 24 hours</option><option value={7}>After 7 days</option><option value={30}>After 30 days</option></select></label>
          <fieldset className="protocol-fieldset"><legend>Allowed contracts</legend>{agent.protocols.map((protocol) => <label key={protocol}><input type="checkbox" checked={protocols.includes(protocol)} onChange={() => toggleProtocol(protocol)} /><span><Check size={14} /></span>{protocol}</label>)}</fieldset>
          <div className="callout"><LockKeyhole size={18} /><span>Your wallet keeps custody. The agent receives only scoped, revocable authority.</span></div>
        </div>}
        {step === 2 && <div className="modal-body">
          <div className="review-list"><div><span>Agent</span><strong>{agent.name}</strong></div><div><span>Capital limit</span><strong>${budget.toLocaleString()}</strong></div><div><span>Expiry</span><strong>{duration} day{duration > 1 ? 's' : ''}</strong></div><div><span>Contracts</span><strong>{protocols.join(', ')}</strong></div><div><span>Network</span><strong>BNB Smart Chain Testnet</strong></div></div>
          <div className="simulation-result"><ShieldCheck size={22} /><div><strong>Demo authority check passed</strong><span>No unlimited approvals or unlisted contract calls appear in this simulated mandate.</span></div></div>
        </div>}
        {step === 3 && <div className="modal-body final-step"><div className="final-icon"><Wallet size={30} /></div><h3>{!account ? 'Connect the owner wallet' : isTargetNetwork ? 'Owner wallet ready' : 'Switch to BSC Testnet'}</h3><p>{!account ? 'Connect an injected EVM wallet to verify the mandate owner.' : isTargetNetwork ? 'The owner account and network are verified. This build saves a local mandate draft; Altana onchain session registration is the next integration step.' : 'MandateFi is currently developing against BNB Smart Chain Testnet (chain ID 97).'}</p>{account && <div className="wallet-proof"><span>Owner</span><strong>{shortAddress(account)}</strong><span>Balance</span><strong>{balance === null ? 'Reading…' : `${balance} tBNB`}</strong></div>}{!account ? <button className="wallet-connect-large" onClick={onConnect}><Wallet size={18} /> Connect wallet</button> : !isTargetNetwork ? <button className="wallet-connect-large" onClick={onSwitchNetwork}><RefreshCw size={18} /> Switch network</button> : null}{walletError && <span className="wallet-error">{walletError}</span>}</div>}
        <div className="modal-footer">{step > 1 ? <button className="secondary-button" onClick={() => setStep(step - 1)}>Back</button> : <span />}{step < 3 ? <button className="primary-button large" disabled={step === 1 && protocols.length === 0} onClick={() => setStep(step + 1)}>Continue <ChevronRight size={17} /></button> : <button className="primary-button large" disabled={!account || !isTargetNetwork} onClick={() => onConfirm(budget, duration, protocols)}>Save mandate draft <Check size={16} /></button>}</div>
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

function MandatesView({ mandates, onRevoke }: { mandates: Mandate[]; onRevoke: (id: string) => void }) {
  return <div><div className="view-title-row"><div><span className="eyebrow">Owner control</span><h1>My mandates</h1></div></div>{mandates.length === 0 ? <div className="empty-state"><div className="empty-icon"><ShieldCheck size={26} /></div><h2>No active mandates</h2><p>Activate an agent to register a scoped session with a spend cap, contract allowlist, and expiry.</p></div> : <div className="mandate-list">{mandates.map((mandate) => <article key={mandate.id} className="mandate-row"><div className="mandate-icon"><Bot size={20} /></div><div className="mandate-main"><strong>{mandate.agentName}</strong><span>{mandate.protocols.join(' · ')}</span></div><div><span>Capital limit</span><strong>${mandate.budget.toLocaleString()}</strong></div><div><span>Expires</span><strong>{mandate.duration} days</strong></div><div><span>Status</span><strong className={mandate.status === 'Active' ? 'status-active' : 'status-revoked'}>{mandate.status}</strong></div><button className="danger-button" disabled={mandate.status === 'Revoked'} onClick={() => onRevoke(mandate.id)}>Revoke</button></article>)}</div>}</div>
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
  const [mandates, setMandates] = useState<Mandate[]>([])
  const [notice, setNotice] = useState('')
  const wallet = useInjectedWallet()
  const registry = use8004Registry()

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

  function confirmMandate(budget: number, duration: number, protocols: string[]) {
    if (!activationAgent) return
    setMandates((current) => [{ id: crypto.randomUUID(), agentId: activationAgent.id, agentName: activationAgent.name, budget, duration, protocols, status: 'Active', createdAt: new Date().toISOString() }, ...current])
    setActivationAgent(null); setSelectedAgent(null); setNotice(`${activationAgent.name} mandate draft saved. Altana session registration is not active yet.`); setView('mandates')
  }

  function revokeMandate(id: string) {
    setMandates((current) => current.map((mandate) => mandate.id === id ? { ...mandate, status: 'Revoked' } : mandate))
    setNotice('Demo mandate revoked locally.')
  }

  const navItems: Array<{ id: View; label: string; icon: typeof Bot }> = [
    { id: 'marketplace', label: 'Marketplace', icon: LayoutGrid }, { id: 'compare', label: 'Compare', icon: ArrowLeftRight },
    { id: 'mandates', label: 'My mandates', icon: ShieldCheck }, { id: 'activity', label: 'Activity preview', icon: Activity },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
      <div className="brand-block"><div className="brand-mark">M</div><div><strong>MandateFi</strong><span>BNB Agent Market</span></div><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)} aria-label="Close menu"><X size={19} /></button></div>
      <nav className="primary-nav">{navItems.map((item) => { const Icon = item.icon; return <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setMenuOpen(false) }}><Icon size={18} /><span>{item.label}</span>{item.id === 'compare' && comparedIds.length > 0 && <b>{comparedIds.length}</b>}</button> })}</nav>
      <div className="network-panel"><div className="network-row"><span><i className={wallet.isTargetNetwork ? 'online' : ''} /> BNB Smart Chain</span><strong>{wallet.isTargetNetwork ? 'Testnet connected' : 'Testnet target'}</strong></div><div className="network-row"><span>8004scan</span><strong>{registry.snapshot ? 'Live' : registry.loading ? 'Connecting' : 'Unavailable'}</strong></div><div className="network-row"><span>Altana sessions</span><strong>Next milestone</strong></div></div>
      <div className="sidebar-foot"><ShieldCheck size={18} /><div><strong>Bounded by design</strong><span>Every activation has a cap, allowlist, and expiry.</span></div></div>
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
        {view === 'mandates' && <MandatesView mandates={mandates} onRevoke={revokeMandate} />}
        {view === 'activity' && <ActivityView />}
      </div>
    </main>
    {comparedIds.length > 0 && view === 'marketplace' && <div className="compare-tray"><div><ArrowLeftRight size={18} /><strong>{comparedIds.length} selected</strong><span>{comparedAgents.map((agent) => agent.name).join(' · ')}</span></div><button className="primary-button" disabled={comparedIds.length < 2} onClick={() => setView('compare')}>Compare now <ArrowRight size={16} /></button></div>}
    {selectedAgent && <DetailDrawer agent={selectedAgent} onClose={() => setSelectedAgent(null)} onActivate={() => { setActivationAgent(selectedAgent); setSelectedAgent(null) }} />}
    {activationAgent && <ActivationModal agent={activationAgent} account={wallet.account} balance={wallet.balance} isTargetNetwork={wallet.isTargetNetwork} walletError={wallet.error} onConnect={() => void wallet.connect()} onSwitchNetwork={() => void wallet.switchNetwork()} onClose={() => setActivationAgent(null)} onConfirm={confirmMandate} />}
    {notice && <div className="toast"><Check size={17} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
    {wallet.error && <div className="toast error-toast"><Info size={17} /><span>{wallet.error}</span><button onClick={wallet.clearError} aria-label="Dismiss wallet error"><X size={15} /></button></div>}
  </div>
}

export default App
