import { createPublicClient, http } from 'viem'
import { bscTestnet } from 'viem/chains'

export const TARGET_CHAIN = bscTestnet
export const TARGET_CHAIN_ID_HEX = '0x61'
export const BSC_TESTNET_RPC_URL = 'https://bsc-testnet-dataseed.bnbchain.org'
export const BSC_TESTNET_EXPLORER_URL = 'https://testnet.bscscan.com'

export const bscTestnetClient = createPublicClient({
  chain: TARGET_CHAIN,
  transport: http(BSC_TESTNET_RPC_URL),
})

export const BSC_TESTNET_WALLET_PARAMS = {
  chainId: TARGET_CHAIN_ID_HEX,
  chainName: 'BNB Smart Chain Testnet',
  nativeCurrency: {
    name: 'Test BNB',
    symbol: 'tBNB',
    decimals: 18,
  },
  rpcUrls: [BSC_TESTNET_RPC_URL],
  blockExplorerUrls: [BSC_TESTNET_EXPLORER_URL],
}
