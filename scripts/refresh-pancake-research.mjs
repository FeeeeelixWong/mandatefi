import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = resolve(projectRoot, 'public/data/pancake-research.json')
const explorerBase = 'https://explorer.pancakeswap.com/api/cached/pools'
const bscRpc = 'https://bsc-rpc.publicnode.com'
const masterChefV3 = '0x556B9306565093C855AEA9AE92A594704c2Cd59e'
const secondsPerYear = 31_536_000
const minimumTvlUsd = 250_000

const tokens = {
  USDT: '0x55d398326f99059ff775485246999027b3197955',
  USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
  WBNB: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  BTCB: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
  ETH: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
  CAKE: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
}

const pairUniverse = [
  ['USDT', 'USDC'],
  ['WBNB', 'USDT'],
  ['WBNB', 'USDC'],
  ['BTCB', 'USDT'],
  ['ETH', 'USDT'],
  ['CAKE', 'USDT'],
  ['CAKE', 'WBNB'],
  ['BTCB', 'WBNB'],
]

const selectors = {
  cakePerSecond: '0xc4f6a8ce',
  totalAllocPoint: '0x17caf6f1',
  poolAddressPid: '0x0743384d',
  poolInfo: '0x1526fe27',
  balanceOf: '0x70a08231',
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampInteger(value, minimum = 0) {
  return Math.max(minimum, Math.round(finiteNumber(value)))
}

function padAddress(address) {
  return address.toLowerCase().replace('0x', '').padStart(64, '0')
}

function padUint(value) {
  return BigInt(value).toString(16).padStart(64, '0')
}

function decodeUint(hex) {
  if (!hex || hex === '0x') return 0n
  return BigInt(hex)
}

async function fetchJson(url, init, attempts = 3) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt + 1 < attempts) await new Promise((resolvePromise) => setTimeout(resolvePromise, 600 * (attempt + 1)))
    } finally {
      clearTimeout(timeout)
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function rpcBatch(calls) {
  if (!calls.length) return []
  const payload = calls.map(([to, data], index) => ({
    jsonrpc: '2.0',
    id: index,
    method: 'eth_call',
    params: [{ to, data }, 'latest'],
  }))
  const result = await fetchJson(bscRpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!Array.isArray(result)) throw new Error('BSC RPC did not return a batch response.')
  const byId = new Map(result.map((entry) => [entry.id, entry.result ?? '0x']))
  return payload.map((entry) => byId.get(entry.id) ?? '0x')
}

function poolLink(pool) {
  const token0 = pool.token0.id.toLowerCase()
  const token1 = pool.token1.id.toLowerCase()
  if (pool.protocol === 'v3') {
    return `https://pancakeswap.finance/add/${token0}/${token1}/${pool.feeTier}?chain=bsc&persistChain=1`
  }
  if (pool.protocol === 'stable') {
    return `https://pancakeswap.finance/stable/add/${token0}/${token1}?chain=bsc&persistChain=1`
  }
  return `https://pancakeswap.finance/liquidity/add/bsc/infinity/${pool.id}?chain=bsc&persistChain=1`
}

function normalisePool(pool) {
  const tvlUsd = finiteNumber(pool.tvlUSD)
  const volumeUsd24h = finiteNumber(pool.volumeUSD24h)
  const feeAprBps = clampInteger(finiteNumber(pool.apr24h) * 10_000)
  const trustedAddresses = new Set(Object.values(tokens))
  if (!trustedAddresses.has(pool.token0?.id?.toLowerCase()) || !trustedAddresses.has(pool.token1?.id?.toLowerCase())) return null
  if (tvlUsd < minimumTvlUsd) return null
  return {
    id: pool.id,
    pair: `${pool.token0.symbol}/${pool.token1.symbol}`,
    protocol: pool.protocol,
    token0Address: pool.token0.id.toLowerCase(),
    token1Address: pool.token1.id.toLowerCase(),
    feeTierBps: pool.protocol === 'v3' ? clampInteger(pool.feeTier / 100) : null,
    tvlUsd: Math.round(tvlUsd),
    volumeUsd24h: Math.round(volumeUsd24h),
    feeAprBps,
    link: poolLink(pool),
  }
}

async function fetchTrustedPools() {
  const protocols = 'protocols=v3&protocols=infinityCl&protocols=infinityBin&protocols=stable'
  const results = await Promise.all(pairUniverse.map(async ([symbol0, symbol1]) => {
    const address0 = tokens[symbol0]
    const address1 = tokens[symbol1]
    const url = `${explorerBase}/list/pair/${address0}/${address1}?chains=bsc&${protocols}&orderBy=tvlUSD`
    const data = await fetchJson(url)
    return (data.rows ?? []).map(normalisePool).filter(Boolean)
  }))
  const deduped = new Map()
  for (const pool of results.flat()) {
    const existing = deduped.get(pool.id)
    if (!existing || existing.tvlUsd < pool.tvlUsd) deduped.set(pool.id, pool)
  }
  return [...deduped.values()]
}

function poolScore(pool) {
  const liquidityScore = Math.min(70, Math.log10(Math.max(pool.tvlUsd, 1)) * 10)
  const activityScore = Math.min(20, Math.log10(Math.max(pool.volumeUsd24h, 1)) * 3)
  const yieldScore = Math.min(10, pool.feeAprBps / 100)
  return liquidityScore + activityScore + yieldScore
}

async function fetchCakeFarmData(v3Pools, cakePriceUsd) {
  if (!v3Pools.length || cakePriceUsd <= 0) return []
  const initialCalls = [
    [masterChefV3, selectors.cakePerSecond],
    [masterChefV3, selectors.totalAllocPoint],
    ...v3Pools.map((pool) => [masterChefV3, selectors.poolAddressPid + padAddress(pool.id)]),
  ]
  const initialResults = await rpcBatch(initialCalls)
  const cakePerSecondRaw = decodeUint(initialResults[0])
  const totalAllocPoint = decodeUint(initialResults[1])
  if (cakePerSecondRaw === 0n || totalAllocPoint === 0n) return []

  const pids = v3Pools.map((_, index) => decodeUint(initialResults[index + 2]))
  const poolInfoResults = await rpcBatch(pids.map((pid) => [masterChefV3, selectors.poolInfo + padUint(pid)]))
  const cakePerSecond = Number(cakePerSecondRaw) / 1e30
  const farms = []

  for (let index = 0; index < v3Pools.length; index += 1) {
    const pool = v3Pools[index]
    const encoded = poolInfoResults[index]
    if (!encoded || encoded === '0x' || encoded.length < 130) continue
    const allocPoint = Number(BigInt(`0x${encoded.slice(2, 66)}`))
    const returnedPool = `0x${encoded.slice(90, 130)}`.toLowerCase()
    if (allocPoint <= 0 || returnedPool !== pool.id.toLowerCase()) continue
    const yearlyCake = cakePerSecond * (allocPoint / Number(totalAllocPoint)) * secondsPerYear
    const rewardAprBps = clampInteger((yearlyCake * cakePriceUsd / pool.tvlUsd) * 10_000)
    farms.push({
      ...pool,
      pid: Number(pids[index]),
      rewardAprBps,
      totalAprBps: pool.feeAprBps + rewardAprBps,
      rewardToken: 'CAKE',
      link: 'https://pancakeswap.finance/liquidity/pools?chain=bsc&type=0',
    })
  }
  return farms.sort((a, b) => b.totalAprBps - a.totalAprBps)
}

function deriveCakePrice(pools) {
  const candidates = pools
    .filter((pool) => pool.pair === 'Cake/USDT' || pool.pair === 'USDT/Cake')
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
  if (!candidates.length) return 0
  const pool = candidates[0]
  return pool.pair === 'Cake/USDT'
    ? finiteNumber(pool.rawToken1Price)
    : finiteNumber(pool.rawToken0Price)
}

async function fetchSyrupEarn(cakePriceUsd) {
  const url = 'https://configs.pancakeswap.com/api/data/cached/syrup-pools?chainId=56&isFinished=false'
  const pools = await fetchJson(url)
  const approved = (Array.isArray(pools) ? pools : []).filter((pool) =>
    pool.sousId !== 0 &&
    pool.stakingToken?.address?.toLowerCase() === tokens.CAKE &&
    pool.earningToken?.address?.toLowerCase() === tokens.USDT,
  )
  if (!approved.length || cakePriceUsd <= 0) return []
  const balanceResults = await rpcBatch(approved.map((pool) => [
    pool.stakingToken.address,
    selectors.balanceOf + padAddress(pool.contractAddress),
  ]))
  return approved.flatMap((pool, index) => {
    const totalStaked = Number(decodeUint(balanceResults[index])) / 10 ** finiteNumber(pool.stakingToken.decimals, 18)
    const tvlUsd = totalStaked * cakePriceUsd
    const yearlyRewardUsd = finiteNumber(pool.tokenPerSecond) * secondsPerYear
    if (!Number.isFinite(tvlUsd) || tvlUsd <= 0) return []
    return [{
      id: String(pool.sousId),
      contractAddress: pool.contractAddress.toLowerCase(),
      stakeSymbol: pool.stakingToken.symbol.toUpperCase(),
      earnSymbol: pool.earningToken.symbol.toUpperCase(),
      tvlUsd: Math.round(tvlUsd),
      rewardAprBps: clampInteger((yearlyRewardUsd / tvlUsd) * 10_000),
      withdrawal: 'Flexible while pool remains active',
      link: 'https://pancakeswap.finance/pools?chain=bsc',
    }]
  }).sort((a, b) => b.rewardAprBps - a.rewardAprBps)
}

async function main() {
  const observedAt = new Date().toISOString()
  const rawPools = await fetchTrustedPools()
  const pools = rawPools.map((pool) => ({ ...pool }))

  // Retain PancakeSwap's pair prices only long enough to derive the CAKE/USD reference.
  const cakePairUrl = `${explorerBase}/list/pair/${tokens.CAKE}/${tokens.USDT}?chains=bsc&protocols=v3&orderBy=tvlUSD`
  const cakePairData = await fetchJson(cakePairUrl)
  const cakePriceCandidates = (cakePairData.rows ?? []).map((row) => ({
    ...normalisePool(row),
    rawToken0Price: row.token0Price,
    rawToken1Price: row.token1Price,
  })).filter((pool) => pool.id)
  const cakePriceUsd = deriveCakePrice(cakePriceCandidates)

  const v3Pools = pools.filter((pool) => pool.protocol === 'v3')
  const [farms, earn] = await Promise.all([
    fetchCakeFarmData(v3Pools, cakePriceUsd),
    fetchSyrupEarn(cakePriceUsd),
  ])
  const liquidity = pools.sort((a, b) => poolScore(b) - poolScore(a)).slice(0, 12)

  const snapshot = {
    schemaVersion: 1,
    generatedAt: observedAt,
    network: { name: 'BNB Chain mainnet', chainId: 56 },
    methodology: {
      tokenUniverse: Object.keys(tokens),
      minimumTvlUsd,
      note: 'Research uses an address allowlist, official PancakeSwap pool data, MasterChef V3 onchain emissions, and active Syrup Pool configuration. Execution remains separately constrained by the owner mandate.',
    },
    liquidity: { observedAt, opportunities: liquidity },
    farms: { observedAt, opportunities: farms.slice(0, 12) },
    earn: { observedAt, opportunities: earn },
    sources: [
      { label: 'PancakeSwap Explorer API', url: 'https://explorer.pancakeswap.com/' },
      { label: 'PancakeSwap MasterChef V3', url: 'https://bscscan.com/address/0x556B9306565093C855AEA9AE92A594704c2Cd59e' },
      { label: 'PancakeSwap Syrup Pool config', url: 'https://configs.pancakeswap.com/api/data/cached/syrup-pools?chainId=56&isFinished=false' },
      { label: 'PancakeSwap AI reference implementation', url: 'https://github.com/pancakeswap/pancakeswap-ai' },
    ],
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  console.log(`Wrote ${outputPath}`)
  console.log(`LP ${liquidity.length} · Farms ${farms.length} · Earn ${earn.length} · CAKE $${cakePriceUsd.toFixed(4)}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
