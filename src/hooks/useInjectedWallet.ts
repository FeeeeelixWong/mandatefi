import { useCallback, useEffect, useState } from 'react'
import { formatEther, type Address } from 'viem'
import { TARGET_CHAIN } from '../lib/chains'
import {
  getInjectedProvider,
  readAccounts,
  readChainId,
  requestAccounts,
  switchToBscTestnet,
  walletErrorMessage,
} from '../lib/wallet'
import { bscTestnetClient } from '../lib/chains'

type WalletStatus = 'idle' | 'connecting' | 'connected' | 'error'

export function useInjectedWallet() {
  const [account, setAccount] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [status, setStatus] = useState<WalletStatus>('idle')
  const [error, setError] = useState('')
  const provider = getInjectedProvider()

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

  const sync = useCallback(async () => {
    const injected = getInjectedProvider()
    if (!injected) return
    try {
      const [accounts, activeChainId] = await Promise.all([readAccounts(injected), readChainId(injected)])
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

  const connect = useCallback(async () => {
    const injected = getInjectedProvider()
    if (!injected) {
      setError('No injected EVM wallet was found. Install MetaMask, OKX Wallet, or another EIP-1193 wallet.')
      setStatus('error')
      return
    }
    setStatus('connecting')
    setError('')
    try {
      const accounts = await requestAccounts(injected)
      const nextAccount = accounts[0] ?? null
      const activeChainId = await readChainId(injected)
      setAccount(nextAccount)
      setChainId(activeChainId)
      setStatus(nextAccount ? 'connected' : 'idle')
      await refreshBalance(nextAccount, activeChainId)
    } catch (connectError) {
      setError(walletErrorMessage(connectError))
      setStatus('error')
    }
  }, [refreshBalance])

  const switchNetwork = useCallback(async () => {
    const injected = getInjectedProvider()
    if (!injected) {
      setError('No injected EVM wallet was found.')
      return
    }
    setError('')
    try {
      await switchToBscTestnet(injected)
      await sync()
    } catch (switchError) {
      setError(walletErrorMessage(switchError))
      setStatus(account ? 'connected' : 'error')
    }
  }, [account, sync])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void sync() }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [sync])

  useEffect(() => {
    if (!provider?.on) return
    const handleAccounts = () => { void sync() }
    const handleChain = () => { void sync() }
    provider.on('accountsChanged', handleAccounts)
    provider.on('chainChanged', handleChain)
    return () => {
      provider.removeListener?.('accountsChanged', handleAccounts)
      provider.removeListener?.('chainChanged', handleChain)
    }
  }, [provider, sync])

  return {
    account,
    balance,
    chainId,
    connect,
    clearError: () => setError(''),
    error,
    hasProvider: Boolean(provider),
    isConnected: Boolean(account),
    isTargetNetwork: chainId === TARGET_CHAIN.id,
    status,
    switchNetwork,
  }
}
