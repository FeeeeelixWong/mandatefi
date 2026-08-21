import { getAddress, type Address } from 'viem'

export type StablecoinSymbol = 'USDT' | 'USDC'

export type StablecoinConfig = {
  symbol: StablecoinSymbol
  name: string
  address: Address
  decimals: 18
  router: Address
  provenance: string
}

export const BSC_TESTNET_WBNB = getAddress('0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd')

export const BSC_TESTNET_STABLECOINS: Record<StablecoinSymbol, StablecoinConfig> = {
  USDT: {
    symbol: 'USDT',
    name: 'Test USDT',
    address: getAddress('0x337610d27c682E347C9cD60BD4b3b107C9d34dDd'),
    decimals: 18,
    router: getAddress('0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3'),
    provenance: 'BNB Chain testnet token with a live PancakeSwap V2 route',
  },
  USDC: {
    symbol: 'USDC',
    name: 'Test USDC',
    address: getAddress('0xCA8eB2dec4Fe3a5abbFDc017dE48E461A936623D'),
    decimals: 18,
    router: getAddress('0xD99D1c33F9fC3444f8101754aBC46c52416550D1'),
    provenance: 'PancakeSwap test token with a live PancakeSwap V2 route',
  },
}

export const DEFAULT_STABLECOIN: StablecoinSymbol = 'USDT'

export function stablecoinConfig(symbol: StablecoinSymbol) {
  return BSC_TESTNET_STABLECOINS[symbol]
}
