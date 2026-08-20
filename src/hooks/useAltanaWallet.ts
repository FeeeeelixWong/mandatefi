import { useCallback, useEffect, useState } from 'react'
import { formatEther, parseEther, type Address, type Hex } from 'viem'
import type { AltanaWalletProfile } from '../integrations/altana'
import { bscTestnetClient } from '../lib/chains'
import { sendNativeTransfer, type Eip1193Provider } from '../lib/wallet'

export type AltanaStage = 'idle' | 'creating' | 'recovering' | 'funding' | 'granting' | 'executing' | 'revoking' | 'error'

const fundingAmount = parseEther('0.01')
const minimumBalance = parseEther('0.003')

function operationErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'The passkey request was cancelled or timed out.'
  }
  if (error instanceof Error) return error.message
  return 'The Altana operation could not be completed.'
}

function displayBalance(value: bigint | null) {
  if (value === null) return '—'
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 5 })
}

export function useAltanaWallet() {
  const [profile, setProfile] = useState<AltanaWalletProfile | null>(null)
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null)
  const [stage, setStage] = useState<AltanaStage>('idle')
  const [error, setError] = useState('')

  const refreshBalance = useCallback(async (activeProfile = profile) => {
    if (!activeProfile) {
      setBalanceWei(null)
      return
    }
    try {
      const { readAltanaBalance } = await import('../integrations/altana')
      setBalanceWei(await readAltanaBalance(activeProfile.wallet.address))
    } catch {
      setBalanceWei(null)
    }
  }, [profile])

  useEffect(() => {
    let active = true
    void import('../integrations/altana').then(({ loadAltanaWallet }) => {
      if (!active) return
      setProfile(loadAltanaWallet())
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refreshBalance() }, 0)
    return () => window.clearTimeout(timeout)
  }, [refreshBalance])

  const create = useCallback(async () => {
    setStage('creating')
    setError('')
    try {
      const { createAltanaWallet } = await import('../integrations/altana')
      const next = await createAltanaWallet()
      setProfile(next)
      await refreshBalance(next)
      setStage('idle')
      return next
    } catch (operationError) {
      setError(operationErrorMessage(operationError))
      setStage('error')
      throw operationError
    }
  }, [refreshBalance])

  const recover = useCallback(async () => {
    setStage('recovering')
    setError('')
    try {
      const { recoverAltanaWallet } = await import('../integrations/altana')
      const next = await recoverAltanaWallet()
      setProfile(next)
      await refreshBalance(next)
      setStage('idle')
      return next
    } catch (operationError) {
      setError(operationErrorMessage(operationError))
      setStage('error')
      throw operationError
    }
  }, [refreshBalance])

  const fund = useCallback(async (provider: Eip1193Provider, from: Address) => {
    if (!profile) throw new Error('Create or recover the Altana wallet first.')
    setStage('funding')
    setError('')
    try {
      const hash = await sendNativeTransfer(provider, from, profile.wallet.address, fundingAmount)
      await bscTestnetClient.waitForTransactionReceipt({ hash, timeout: 90_000 })
      await refreshBalance(profile)
      setStage('idle')
      return hash
    } catch (operationError) {
      setError(operationErrorMessage(operationError))
      setStage('error')
      throw operationError
    }
  }, [profile, refreshBalance])

  const activate = useCallback(async (durationDays: number) => {
    if (!profile) throw new Error('Create or recover the Altana wallet first.')
    setError('')
    try {
      const { grantAndVerifyAltanaMandate } = await import('../integrations/altana')
      const result = await grantAndVerifyAltanaMandate(profile, durationDays, setStage)
      await refreshBalance(profile)
      setStage('idle')
      return result
    } catch (operationError) {
      setError(operationErrorMessage(operationError))
      setStage('error')
      throw operationError
    }
  }, [profile, refreshBalance])

  const revoke = useCallback(async (publicKey: Hex) => {
    if (!profile) throw new Error('Recover the Altana owner passkey before revoking.')
    setStage('revoking')
    setError('')
    try {
      const { revokeAltanaMandate } = await import('../integrations/altana')
      const result = await revokeAltanaMandate(profile, publicKey)
      await refreshBalance(profile)
      setStage('idle')
      return result
    } catch (operationError) {
      setError(operationErrorMessage(operationError))
      setStage('error')
      throw operationError
    }
  }, [profile, refreshBalance])

  return {
    activate,
    address: profile?.wallet.address ?? null,
    balance: displayBalance(balanceWei),
    balanceWei,
    clearError: () => setError(''),
    create,
    error,
    fund,
    hasMinimumBalance: balanceWei !== null && balanceWei >= minimumBalance,
    isBusy: !['idle', 'error'].includes(stage),
    isPasskeySupported: typeof PublicKeyCredential !== 'undefined' && Boolean(navigator.credentials),
    profile,
    recover,
    refreshBalance,
    revoke,
    stage,
  }
}
