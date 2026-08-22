import { describe, expect, it, vi } from 'vitest'
import type { Address, Hex } from 'viem'
import {
  getLegacyInjectedWallets,
  mergeInjectedWallets,
  sendNativeTransfer,
  walletFromAnnouncement,
  type Eip1193Provider,
} from './wallet'

const provider = (flags: Record<string, boolean> = {}) => ({ request: vi.fn(), ...flags }) as Eip1193Provider

describe('injected wallet discovery', () => {
  it('finds providers exposed through multi-provider and wallet-specific injection', () => {
    const metamask = provider({ isMetaMask: true })
    const rabby = provider({ isRabby: true, isMetaMask: true })
    const okx = provider({ isOkxWallet: true })
    const scope = {
      ethereum: { request: vi.fn(), providers: [metamask, rabby] },
      okxwallet: okx,
    } as unknown as Window

    const wallets = getLegacyInjectedWallets(scope)

    expect(wallets.map((wallet) => wallet.name)).toEqual(['OKX Wallet', 'MetaMask', 'Rabby Wallet'])
    expect(new Set(wallets.map((wallet) => wallet.provider)).size).toBe(3)
  })

  it('deduplicates a provider announced through both legacy injection and EIP-6963', () => {
    const okx = provider({ isOkxWallet: true })
    const legacy = getLegacyInjectedWallets({ okxwallet: okx } as Window)
    const announced = walletFromAnnouncement({
      info: { uuid: 'okx-uuid', name: 'OKX Wallet', rdns: 'com.okex.wallet', icon: 'data:image/png;base64,abc' },
      provider: okx,
    })

    expect(announced).not.toBeNull()
    const merged = mergeInjectedWallets(legacy, announced!)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ name: 'OKX Wallet', rdns: 'com.okex.wallet' })
  })
})

describe('sendNativeTransfer', () => {
  it('sends the exact owner, smart-wallet target, and native amount', async () => {
    const hash = `0x${'a'.repeat(64)}` as Hex
    const request = vi.fn().mockResolvedValue(hash)
    const provider = { request } as Eip1193Provider
    const from = '0x1111111111111111111111111111111111111111' as Address
    const to = '0x2222222222222222222222222222222222222222' as Address

    await expect(sendNativeTransfer(provider, from, to, 10_000_000_000_000_000n)).resolves.toBe(hash)
    expect(request).toHaveBeenCalledWith({
      method: 'eth_sendTransaction',
      params: [{ from, to, value: '0x2386f26fc10000' }],
    })
  })

  it('rejects malformed wallet responses', async () => {
    const provider = { request: vi.fn().mockResolvedValue(null) } as Eip1193Provider
    const address = '0x1111111111111111111111111111111111111111' as Address

    await expect(sendNativeTransfer(provider, address, address, 1n)).rejects.toThrow('invalid transaction hash')
  })
})
