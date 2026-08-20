import type { Address } from 'viem'
import { getAddress } from 'viem'
import { BSC_TESTNET_WALLET_PARAMS, TARGET_CHAIN_ID_HEX } from './chains'

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void
  removeListener?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider
  }
}

export function getInjectedProvider() {
  return typeof window === 'undefined' ? undefined : window.ethereum
}

export async function requestAccounts(provider: Eip1193Provider): Promise<Address[]> {
  const accounts = await provider.request({ method: 'eth_requestAccounts' })
  if (!Array.isArray(accounts)) return []
  return accounts.filter((account): account is string => typeof account === 'string').map((account) => getAddress(account))
}

export async function readAccounts(provider: Eip1193Provider): Promise<Address[]> {
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (!Array.isArray(accounts)) return []
  return accounts.filter((account): account is string => typeof account === 'string').map((account) => getAddress(account))
}

export async function readChainId(provider: Eip1193Provider): Promise<number> {
  const chainId = await provider.request({ method: 'eth_chainId' })
  if (typeof chainId !== 'string') throw new Error('Wallet returned an invalid chain ID.')
  return Number.parseInt(chainId, 16)
}

export async function switchToBscTestnet(provider: Eip1193Provider) {
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: TARGET_CHAIN_ID_HEX }],
    })
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error ? Number(error.code) : undefined
    if (code !== 4902) throw error
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [BSC_TESTNET_WALLET_PARAMS],
    })
  }
}

export function walletErrorMessage(error: unknown) {
  if (typeof error === 'object' && error) {
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    const code = 'code' in error ? Number(error.code) : undefined
    if (code === 4001) return 'Wallet request was cancelled.'
    if (message) return message
  }
  return 'The wallet request could not be completed.'
}

export function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
