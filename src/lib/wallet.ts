import type { Address, Hex } from 'viem'
import { getAddress, toHex } from 'viem'
import { BSC_TESTNET_WALLET_PARAMS, TARGET_CHAIN_ID_HEX } from './chains'

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>
  on?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void
  removeListener?(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void
}

type BrandedProvider = Eip1193Provider & {
  providers?: Eip1193Provider[]
  isBinance?: boolean
  isBraveWallet?: boolean
  isCoinbaseWallet?: boolean
  isMetaMask?: boolean
  isOkxWallet?: boolean
  isRabby?: boolean
  isTrust?: boolean
  isTrustWallet?: boolean
}

export type Eip6963ProviderInfo = {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo
  provider: Eip1193Provider
}

export type InjectedWallet = {
  id: string
  name: string
  rdns?: string
  icon?: string
  provider: Eip1193Provider
}

declare global {
  interface Window {
    ethereum?: BrandedProvider
    okxwallet?: BrandedProvider
    trustwallet?: BrandedProvider
    BinanceChain?: BrandedProvider
    coinbaseWalletExtension?: BrandedProvider
    phantom?: { ethereum?: BrandedProvider }
  }
}

const walletPriority = [
  'OKX Wallet',
  'MetaMask',
  'Rabby Wallet',
  'Coinbase Wallet',
  'Trust Wallet',
  'Binance Wallet',
  'Phantom',
  'Brave Wallet',
]

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wallet'
}

function knownWalletName(provider: Eip1193Provider, scope?: Window) {
  const branded = provider as BrandedProvider
  if (branded.isOkxWallet || provider === scope?.okxwallet) return 'OKX Wallet'
  if (branded.isRabby) return 'Rabby Wallet'
  if (branded.isCoinbaseWallet || provider === scope?.coinbaseWalletExtension) return 'Coinbase Wallet'
  if (branded.isTrust || branded.isTrustWallet || provider === scope?.trustwallet) return 'Trust Wallet'
  if (branded.isBinance || provider === scope?.BinanceChain) return 'Binance Wallet'
  if (provider === scope?.phantom?.ethereum) return 'Phantom'
  if (branded.isBraveWallet) return 'Brave Wallet'
  if (branded.isMetaMask) return 'MetaMask'
  return 'Browser Wallet'
}

function validIcon(icon: unknown): icon is string {
  return typeof icon === 'string' && (icon.startsWith('data:image/') || icon.startsWith('https://'))
}

function walletSort(a: InjectedWallet, b: InjectedWallet) {
  const aPriority = walletPriority.indexOf(a.name)
  const bPriority = walletPriority.indexOf(b.name)
  const aRank = aPriority === -1 ? walletPriority.length : aPriority
  const bRank = bPriority === -1 ? walletPriority.length : bPriority
  return aRank - bRank || a.name.localeCompare(b.name)
}

export function walletFromAnnouncement(detail: Eip6963ProviderDetail): InjectedWallet | null {
  if (!detail?.provider || typeof detail.provider.request !== 'function' || !detail.info?.uuid || !detail.info.name) return null
  return {
    id: `eip6963:${detail.info.uuid}`,
    name: detail.info.name,
    rdns: detail.info.rdns || undefined,
    icon: validIcon(detail.info.icon) ? detail.info.icon : undefined,
    provider: detail.provider,
  }
}

export function mergeInjectedWallets(current: InjectedWallet[], incoming: InjectedWallet) {
  const providerIndex = current.findIndex((wallet) => wallet.provider === incoming.provider)
  if (providerIndex >= 0) {
    const next = [...current]
    next[providerIndex] = {
      ...incoming,
      id: current[providerIndex].id,
      icon: incoming.icon ?? current[providerIndex].icon,
      rdns: incoming.rdns ?? current[providerIndex].rdns,
    }
    return next.sort(walletSort)
  }
  if (current.some((wallet) => wallet.id === incoming.id)) return current
  return [...current, incoming].sort(walletSort)
}

export function getLegacyInjectedWallets(scope?: Window): InjectedWallet[] {
  if (!scope) return []
  const providers: Eip1193Provider[] = []
  const add = (provider?: Eip1193Provider) => {
    if (provider && typeof provider.request === 'function' && !providers.includes(provider)) providers.push(provider)
  }

  const multiProviders = scope.ethereum?.providers ?? []
  multiProviders.forEach(add)
  add(scope.okxwallet)
  if (!multiProviders.length) add(scope.ethereum)
  add(scope.trustwallet)
  add(scope.BinanceChain)
  add(scope.coinbaseWalletExtension)
  add(scope.phantom?.ethereum)

  return providers.map((provider, index) => {
    const name = knownWalletName(provider, scope)
    return {
      id: `legacy:${slug(name)}:${index}`,
      name,
      provider,
    }
  }).sort(walletSort)
}

/** Compatibility fallback for integrations that only accept one provider. */
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

export async function readNativeBalance(provider: Eip1193Provider, address: Address): Promise<bigint> {
  const balance = await provider.request({
    method: 'eth_getBalance',
    params: [address, 'latest'],
  })
  if (typeof balance !== 'string' || !/^0x[0-9a-f]+$/i.test(balance)) {
    throw new Error('Wallet returned an invalid native balance.')
  }
  return BigInt(balance)
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

export async function sendNativeTransfer(
  provider: Eip1193Provider,
  from: Address,
  to: Address,
  value: bigint,
): Promise<Hex> {
  const result = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to, value: toHex(value) }],
  })
  if (typeof result !== 'string' || !result.startsWith('0x')) {
    throw new Error('Wallet returned an invalid transaction hash.')
  }
  return result as Hex
}

export function walletErrorMessage(error: unknown) {
  if (typeof error === 'object' && error) {
    const message = 'message' in error && typeof error.message === 'string' ? error.message : ''
    const code = 'code' in error ? Number(error.code) : undefined
    if (code === 4001) return 'Wallet request was cancelled.'
    if (code === -32002) return 'A wallet request is already open. Complete it in the wallet extension.'
    if (message) return message
  }
  return 'The wallet request could not be completed.'
}

export function shortAddress(address: Address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
