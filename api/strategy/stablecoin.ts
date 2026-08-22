import { createHash, randomUUID } from 'node:crypto'
import {
  buildStablecoinAllocatorPrompt,
  deterministicStablecoinSelection,
  stablecoinSelectionOutputSchema,
  stablecoinSelectionRequestSchema,
  STABLECOIN_ALLOCATOR_PROMPT_VERSION,
} from '../../src/domain/stablecoinAllocator.js'
import { callDeepSeekJson } from '../_lib/deepseek.js'
import { configureRequest, parseBody, type ApiRequest, type ApiResponse } from '../_lib/http.js'

export const maxDuration = 60

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!configureRequest(request, response, { requireBrowserOrigin: true })) return
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }

  try {
    const contentLength = Number(request.headers['content-length'] ?? 0)
    if (contentLength > 64_000) {
      response.status(413).json({ error: 'Stablecoin selection payload is too large.' })
      return
    }
    const input = stablecoinSelectionRequestSchema.parse(parseBody(request.body))
    const generatedAt = new Date().toISOString()
    const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const runId = randomUUID()
    const model = process.env.DEEPSEEK_MANAGER_MODEL ?? 'deepseek-v4-pro'
    let selection = deterministicStablecoinSelection(input)
    let modelMode: 'DEEPSEEK' | 'DETERMINISTIC_FALLBACK' = 'DETERMINISTIC_FALLBACK'
    let modelName = 'risk-adjusted-rules-v1'

    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const result = await callDeepSeekJson({
          model,
          system: 'You are MandateFi stablecoin allocation agent. Use only supplied evidence and return strict json.',
          user: buildStablecoinAllocatorPrompt(input),
          schema: stablecoinSelectionOutputSchema,
          maxTokens: 1_000,
          thinking: 'disabled',
        })
        selection = result.value
        modelMode = 'DEEPSEEK'
        modelName = model
      } catch (error) {
        console.error('DeepSeek stablecoin allocator fell back to deterministic selection.', error)
      }
    }

    console.log(JSON.stringify({
      event: 'mandatefi.stablecoin-selection',
      runId,
      generatedAt,
      inputHash,
      selected: selection.stablecoin,
      modelMode,
    }))
    response.status(200).json({
      ...selection,
      generatedAt,
      modelMode,
      modelName,
      promptVersion: STABLECOIN_ALLOCATOR_PROMPT_VERSION,
      inputHash,
      candidates: input.candidates,
    })
  } catch (error) {
    console.error('MandateFi stablecoin selection failed.', error)
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Stablecoin selection failed.',
    })
  }
}
