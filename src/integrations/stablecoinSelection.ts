import {
  deterministicStablecoinSelection,
  STABLECOIN_ALLOCATOR_PROMPT_VERSION,
  stablecoinSelectionResponseSchema,
  type StablecoinSelectionEvidence,
  type StablecoinSelectionRequest,
} from '../domain/stablecoinAllocator'

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function stablecoinApiUrl() {
  const configured = import.meta.env.VITE_AGENT_API_URL?.replace(/\/$/, '')
  return configured ? `${configured}/api/strategy/stablecoin` : '/api/strategy/stablecoin'
}

export async function requestStablecoinSelection(
  input: StablecoinSelectionRequest,
): Promise<StablecoinSelectionEvidence> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 55_000)
  try {
    const response = await fetch(stablecoinApiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null) as unknown
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Stablecoin allocator returned ${response.status}.`
      throw new Error(message)
    }
    return stablecoinSelectionResponseSchema.parse(body)
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function buildLocalStablecoinSelection(
  input: StablecoinSelectionRequest,
): Promise<StablecoinSelectionEvidence> {
  return stablecoinSelectionResponseSchema.parse({
    ...deterministicStablecoinSelection(input),
    generatedAt: new Date().toISOString(),
    modelMode: 'DETERMINISTIC_FALLBACK',
    modelName: 'risk-adjusted-rules-v1',
    promptVersion: STABLECOIN_ALLOCATOR_PROMPT_VERSION,
    inputHash: await sha256(JSON.stringify(input)),
    candidates: input.candidates,
  })
}
