import type { z } from 'zod'

type DeepSeekResult<T> = {
  value: T
  latencyMs: number
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

type JsonCallOptions<T> = {
  model: string
  system: string
  user: string
  schema: z.ZodType<T>
  maxTokens?: number
}

const responseSchema = {
  parse(value: unknown) {
    if (!value || typeof value !== 'object') throw new Error('DeepSeek returned an invalid response envelope.')
    const data = value as {
      choices?: Array<{ message?: { content?: string | null } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek returned an empty JSON response.')
    return { content, usage: data.usage }
  },
}

export async function callDeepSeekJson<T>(options: JsonCallOptions<T>): Promise<DeepSeekResult<T>> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured.')
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/$/, '')
  let lastError: unknown

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: options.model,
          messages: [
            { role: 'system', content: options.system },
            { role: 'user', content: options.user },
          ],
          response_format: { type: 'json_object' },
          max_tokens: options.maxTokens ?? 1_200,
          stream: false,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500)
        throw new Error(`DeepSeek returned ${response.status}: ${detail || response.statusText}`)
      }
      const parsedResponse = responseSchema.parse(await response.json())
      const parsedJson = JSON.parse(parsedResponse.content) as unknown
      const value = options.schema.parse(parsedJson)
      return {
        value,
        latencyMs: Date.now() - startedAt,
        usage: parsedResponse.usage ? {
          promptTokens: parsedResponse.usage.prompt_tokens,
          completionTokens: parsedResponse.usage.completion_tokens,
          totalTokens: parsedResponse.usage.total_tokens,
        } : undefined,
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('DeepSeek JSON request failed.')
}
