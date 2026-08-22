import { describe, expect, it } from 'vitest'
import type { PancakeModuleReceipt } from '../types'
import { completedPancakeModules, latestPancakeModuleReceipt } from './pancakeReceipts'

function receipt(overrides: Partial<PancakeModuleReceipt>): PancakeModuleReceipt {
  return {
    id: crypto.randomUUID(),
    module: 'EARN',
    operation: 'ALLOCATE',
    state: 'CONFIRMED',
    createdAt: new Date().toISOString(),
    contract: '0x0000000000000000000000000000000000000001',
    note: 'test',
    ...overrides,
  }
}

describe('PancakeSwap module completion', () => {
  it('does not count Earn until the CakePool deposit confirms', () => {
    const receipts = [
      receipt({ module: 'EARN', operation: 'ALLOCATE', state: 'CONFIRMED' }),
      receipt({ module: 'EARN', operation: 'DEPOSIT_EARN', state: 'FAILED' }),
    ]

    expect(completedPancakeModules(receipts).has('EARN')).toBe(false)
    expect(latestPancakeModuleReceipt(receipts, 'EARN')?.state).toBe('FAILED')
  })

  it('counts only each module terminal operation', () => {
    const receipts = [
      receipt({ module: 'SWAP', operation: 'ALLOCATE' }),
      receipt({ module: 'LIQUIDITY', operation: 'ADD_LIQUIDITY' }),
      receipt({ module: 'FARM', operation: 'STAKE_LP' }),
      receipt({ module: 'EARN', operation: 'ALLOCATE' }),
      receipt({ module: 'EARN', operation: 'DEPOSIT_EARN' }),
    ]

    expect([...completedPancakeModules(receipts)]).toEqual(['SWAP', 'LIQUIDITY', 'FARM', 'EARN'])
  })
})
