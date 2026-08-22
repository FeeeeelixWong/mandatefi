import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatEther, type Address } from 'viem'
import { bscTestnetClient, TARGET_CHAIN } from '../lib/chains'
import {
  getLegacyInjectedWallets,
  mergeInjectedWallets,
  readAccounts,
  readChainId,
  requestAccounts,
  switchToBscTestnet,
  walletErrorMessage,
  walletFromAnnouncement,
  type Eip1193Provider,
  type Eip6963ProviderDetail,
  type InjectedWallet,
} from '../lib/wallet'

export type WalletStatus = 'idle' | 'discovering' | 'connecting' | 'connected' | 'error'

const walletPreferenceKey = 'mandatefi.injected-wallet.preference'

function savedPreference() {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem(walletPreferenceKey) ?? ''
}

export function useInjectedWallet() {
  const [wallets, setWallets] = useState<InjectedWallet[]>([])
  const [selectedWalletId, setSelectedWalletId] = useState('')
  const [account, setAccount] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [status, setStatus] = useState<WalletStatus>('discovering')
  const [error, setError] = useState('')
  const preference = useRef(savedPreference())
  const selectedWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === selectedWalletId) ?? null,
    [selectedWalletId, wallets],
  )
  const provider = selectedWallet?.provider

  const registerWallet = useCallback((wallet: InjectedWallet) => {
    setWallets((current) => mergeInjectedWallets(current, wallet))
    setSelectedWalletId((current) => {
      if (current) return current
      if (preference.current && (wallet.rdns === preference.current || wallet.id === preference.current)) return wallet.id
      return current
    })
  }, [])

  useEffect(() => {
    const handleAnnouncement = (event: Event) => {
      const wallet = walletFromAnnouncement((event as CustomEvent<Eip6963ProviderDetail>).detail)
      if (wallet) registerWallet(wallet)
    }
    window.addEventListener('eip6963:announceProvider', handleAnnouncement)
    getLegacyInjectedWallets(window).forEach(registerWallet)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    const discoveryTimer = window.setTimeout(() => setStatus((current) => current === 'discovering' ? 'idle' : current), 400)
    return () => {
      window.clearTimeout(discoveryTimer)
      window.removeEventListener('eip6963:announceProvider', handleAnnouncement)
    }
  }, [registerWallet])

  const refreshBalance = useCallback(async (address: Address | null, activeChainId: number | null) => {
    if (!address || activeChainId !== TARGET_CHAIN.id) {
      setBalance(null)
      return
    }
    try {
      const wei = await bscTestnetClient.getBalance({ address })
      setBalance(Number(formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 4 }))
    } catch {
      setBalance(null)
    }
  }, [])

  const syncProvider = useCallback(async (activeProvider?: Eip1193Provider) => {
    if (!activeProvider) return
    try {
      const [accounts, activeChainId] = await Promise.all([readAccounts(activeProvider), readChainId(activeProvider)])
      const nextAccount = accounts[0] ?? null
      setAccount(nextAccount)
      setChainId(activeChainId)
      setStatus(nextAccount ? 'connected' : 'idle')
      await refreshBalance(nextAccount, activeChainId)
    } catch (syncError) {
      setError(walletErrorMessage(syncError))
      setStatus('error')
    }
  }, [refreshBalance])

  const connect = useCallback(async (walletId?: string) => {
    const wallet = wallets.find((candidate) => candidate.id === walletId)
      ?? selectedWallet
      ?? (wallets.length === 1 ? wallets[0] : null)
    if (!wallet) {
      setError(wallets.length ? 'Choose a wallet to continue.' : 'No injected EVM wallet was found. Install a supported wallet, then reload this page.')
      setStatus('error')
      return false
    }
    setSelectedWalletId(wallet.id)
    setAccount(null)
    setChainId(null)
    setBalance(null)
    setStatus('connecting')
    setError('')
    try {
      const accounts = await requestAccounts(wallet.provider)
      const nextAccount = accounts[0] ?? null
      if (!nextAccount) throw new Error(`${wallet.name} did not return an account.`)
      const activeChainId = await readChainId(wallet.provider)
      const stablePreference = wallet.rdns ?? wallet.id
      preference.current = stablePreference
      window.localStorage.setItem(walletPreferenceKey, stablePreference)
      setAccount(nextAccount)
      setChainId(activeChainId)
      setStatus('connected')
      await refreshBalance(nextAccount, activeChainId)
      return true
    } catch (connectError) {
      setError(walletErrorMessage(connectError))
      setStatus('error')
      return false
    }
  }, [refreshBalance, selectedWallet, wallets])

  const switchNetwork = useCallback(async () => {
    if (!provider) {
      setError('Choose and connect a wallet first.')
      return false
    }
    setError('')
    try {
      await switchToBscTestnet(provider)
      await syncProvider(provider)
      return true
    } catch (switchError) {
      setError(walletErrorMessage(switchError))
      setStatus(account ? 'connected' : 'error')
      return false
    }
  }, [account, provider, syncProvider])

  const refresh = useCallback(async () => {
    await syncProvider(provider)
  }, [provider, syncProvider])

  useEffect(() => {
    if (!provider) return
    const timeoutId = window.setTimeout(() => { void syncProvider(provider) }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [provider, syncProvider])

  useEffect(() => {
    if (!provider?.on) return
    const handleAccounts = () => { void syncProvider(provider) }
    const handleChain = () => { void syncProvider(provider) }
    provider.on('accountsChanged', handleAccounts)
    provider.on('chainChanged', handleChain)
    return () => {
      provider.removeListener?.('accountsChanged', handleAccounts)
      provider.removeListener?.('chainChanged', handleChain)
    }
  }, [provider, syncProvider])

  return {
    account,
    balance,
    chainId,
    connect,
    clearError: () => setError(''),
    error,
    hasProvider: wallets.length > 0,
    isConnected: Boolean(account),
    isTargetNetwork: chainId === TARGET_CHAIN.id,
    provider,
    refresh,
    selectedWallet,
    selectedWalletId,
    status,
    switchNetwork,
    wallets,
  }
}
