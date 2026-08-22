import { createPublicClient, getAddress, http } from 'viem'
import { bscTestnet } from 'viem/chains'

const rpcUrl = process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'
const wallet = getAddress(process.argv[2] || '0x2cd25c624f1a9e75c2991db6f8636f712c38914a')
const contracts = {
  router: getAddress('0xD99D1c33F9fC3444f8101754aBC46c52416550D1'),
  cake: getAddress('0xFa60D973F7642B748046464e165A65B7323b0DEE'),
  lp: getAddress('0xa96818CA65B57bEc2155Ba5c81a70151f63300CD'),
  masterChef: getAddress('0xB4A466911556e39210a6bB2FaECBB59E4eB7E43d'),
  cakePool: getAddress('0x683433ba14e8F26774D43D3E90DA6Dd7a22044Fe'),
}
const client = createPublicClient({ chain: bscTestnet, transport: http(rpcUrl) })
const erc20Abi = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }]
const pairAbi = [
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }] },
]
const chefAbi = [{ name: 'userInfo', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }, { type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'int256' }, { type: 'uint256' }] }]
const poolAbi = [
  { name: 'userInfo', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }] },
  { name: 'getPricePerFullShare', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
]

const bytecode = Object.fromEntries(await Promise.all(Object.entries(contracts).map(async ([name, address]) => {
  const code = await client.getCode({ address })
  if (!code || code === '0x') throw new Error(`${name} has no runtime bytecode at ${address}`)
  return [name, { address, byteLength: (code.length - 2) / 2 }]
})))
const [cakeBalance, lpBalance, token0, reserves, farm, earn, pricePerShare] = await Promise.all([
  client.readContract({ address: contracts.cake, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
  client.readContract({ address: contracts.lp, abi: erc20Abi, functionName: 'balanceOf', args: [wallet] }),
  client.readContract({ address: contracts.lp, abi: pairAbi, functionName: 'token0' }),
  client.readContract({ address: contracts.lp, abi: pairAbi, functionName: 'getReserves' }),
  client.readContract({ address: contracts.masterChef, abi: chefAbi, functionName: 'userInfo', args: [4n, wallet] }),
  client.readContract({ address: contracts.cakePool, abi: poolAbi, functionName: 'userInfo', args: [wallet] }),
  client.readContract({ address: contracts.cakePool, abi: poolAbi, functionName: 'getPricePerFullShare' }),
])

console.log(JSON.stringify({
  network: 'BSC Testnet',
  chainId: 97,
  wallet,
  contracts: bytecode,
  pair: { token0, reserve0: reserves[0].toString(), reserve1: reserves[1].toString() },
  positions: {
    cakeWallet: cakeBalance.toString(),
    lpWallet: lpBalance.toString(),
    masterChefPid4: farm[0].toString(),
    cakePoolShares: earn[0].toString(),
    cakePoolPricePerShare: pricePerShare.toString(),
  },
}, null, 2))
