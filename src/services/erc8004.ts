import { z } from 'zod'

const registryAgentSchema = z.object({
  token_id: z.string(),
  chain_id: z.number(),
  owner_address: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  is_verified: z.boolean(),
  x402_supported: z.boolean(),
  total_feedbacks: z.number(),
  average_score: z.number(),
})

const registryResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(registryAgentSchema),
  meta: z.object({
    pagination: z.object({
      total: z.number(),
      hasMore: z.boolean(),
    }),
  }),
})

export type RegistryAgent = z.infer<typeof registryAgentSchema>
export type RegistrySnapshot = {
  agents: RegistryAgent[]
  total: number
  fetchedAt: string
}

const API_BASE = 'https://8004scan.io/api/v1/public'

export async function fetchBnbRegistrySnapshot(signal?: AbortSignal): Promise<RegistrySnapshot> {
  const response = await fetch(`${API_BASE}/agents?chainId=56&limit=4`, {
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) throw new Error(`8004scan returned HTTP ${response.status}.`)
  const parsed = registryResponseSchema.parse(await response.json())
  return {
    agents: parsed.data,
    total: parsed.meta.pagination.total,
    fetchedAt: new Date().toISOString(),
  }
}
