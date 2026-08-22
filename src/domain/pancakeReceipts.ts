import type { PancakeModule, PancakeModuleReceipt } from '../types'

const completionOperation: Record<PancakeModule, PancakeModuleReceipt['operation']> = {
  SWAP: 'ALLOCATE',
  LIQUIDITY: 'ADD_LIQUIDITY',
  FARM: 'STAKE_LP',
  EARN: 'DEPOSIT_EARN',
}

export function completedPancakeModules(receipts: PancakeModuleReceipt[] = []) {
  return new Set(receipts
    .filter((item) => item.state === 'CONFIRMED' && item.operation === completionOperation[item.module])
    .map((item) => item.module))
}

export function latestPancakeModuleReceipt(receipts: PancakeModuleReceipt[] = [], module: PancakeModule) {
  return [...receipts].reverse().find((item) => item.module === module)
}
