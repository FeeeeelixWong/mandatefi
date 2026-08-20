import { describe, expect, it, vi } from 'vitest'
import type { Address, Hex } from 'viem'
import { sendNativeTransfer, type Eip1193Provider } from './wallet'

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
