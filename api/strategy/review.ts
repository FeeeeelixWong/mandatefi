import { createHash, randomUUID } from 'node:crypto'
import {
  agentReviewRequestSchema,
  expertRecommendationOutputSchema,
  specialistJudgementOutputSchema,
  deserializePortfolioPlan,
} from '../../src/domain/agentContracts.js'
import { buildAssetManagerPrompt, ASSET_MANAGER_PROMPT_VERSION } from '../../src/domain/assetManagerPrompt.js'
import {
  applySpecialistJudgements,
  type SpecialistJudgement,
} from '../../src/domain/investmentCommittee.js'
import { buildSpecialistPrompt, SPECIALIST_PROMPT_VERSION } from '../../src/domain/specialistPrompts.js'
import { persistAgentRun } from '../_lib/audit.js'
import { callDeepSeekJson } from '../_lib/deepseek.js'
import { configureRequest, parseBody, type ApiRequest, type ApiResponse } from '../_lib/http.js'

export const maxDuration = 120

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (!configureRequest(request, response, { requireBrowserOrigin: true })) return
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }
  if (!process.env.DEEPSEEK_API_KEY) {
    response.status(503).json({ error: 'DeepSeek is not configured. The client should use its deterministic fallback.' })
    return
  }

  try {
    const contentLength = Number(request.headers['content-length'] ?? 0)
    if (contentLength > 256_000) {
      response.status(413).json({ error: 'Review payload is too large.' })
      return
    }
    const input = agentReviewRequestSchema.parse(parseBody(request.body))
    const runId = randomUUID()
    const generatedAt = new Date().toISOString()
    const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const specialistModel = process.env.DEEPSEEK_SPECIALIST_MODEL ?? 'deepseek-v4-flash'
    const managerModel = process.env.DEEPSEEK_MANAGER_MODEL ?? 'deepseek-v4-pro'

    const specialistResults = await Promise.allSettled(input.baseCommittee.reports.map(async (report) => {
      const prompt = buildSpecialistPrompt(report.agentId, report, input)
      const result = await callDeepSeekJson({
        model: specialistModel,
        system: prompt.system,
        user: prompt.user,
        schema: specialistJudgementOutputSchema,
        maxTokens: 900,
        thinking: 'disabled',
      })
      return {
        agentId: report.agentId,
        ...result.value,
        inference: {
          mode: 'DEEPSEEK' as const,
          model: specialistModel,
          promptVersion: SPECIALIST_PROMPT_VERSION,
          latencyMs: result.latencyMs,
        },
      } satisfies SpecialistJudgement
    }))

    specialistResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`DeepSeek specialist ${input.baseCommittee.reports[index]?.agentId ?? index} fell back.`, result.reason)
      }
    })
    const judgements = specialistResults.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    const committee = applySpecialistJudgements(input.baseCommittee, judgements, runId)
    const portfolioPlan = deserializePortfolioPlan(input.executionPlan)
    const managerPrompt = buildAssetManagerPrompt({
      mandate: input.mandate,
      strategy: input.strategy,
      executionPlan: portfolioPlan,
      activeTriggers: input.activeTriggers,
      adapterCoverage: Object.fromEntries(input.strategy.actions.map((action) => [action.title, action.coverage])),
      committee,
    })

    let recommendation = input.fallbackRecommendation
    let resolvedManagerModel = 'rules-engine'
    let managerUsed = false
    try {
      const managerResult = await callDeepSeekJson({
        model: managerModel,
        system: 'You are MandateFi portfolio manager. Follow the supplied policy prompt exactly and return strict json only.',
        user: managerPrompt,
        schema: expertRecommendationOutputSchema,
        maxTokens: 1_200,
        thinking: 'enabled',
      })
      recommendation = managerResult.value
      resolvedManagerModel = managerModel
      managerUsed = true
    } catch (error) {
      console.error('DeepSeek manager fell back to deterministic recommendation.', error)
    }

    const deepSeekSpecialists = judgements.length
    const modelMode = managerUsed && deepSeekSpecialists === input.baseCommittee.reports.length
      ? 'DEEPSEEK' as const
      : managerUsed || deepSeekSpecialists > 0 ? 'HYBRID_FALLBACK' as const : 'DETERMINISTIC_FALLBACK' as const
    committee.modelMode = deepSeekSpecialists === input.baseCommittee.reports.length
      ? 'DEEPSEEK'
      : deepSeekSpecialists > 0 ? 'HYBRID_FALLBACK' : 'DETERMINISTIC_FALLBACK'

    const resultWithoutPersistence = {
      runId,
      generatedAt,
      modelMode,
      managerModel: resolvedManagerModel,
      promptVersion: ASSET_MANAGER_PROMPT_VERSION,
      inputHash,
      committee,
      recommendation,
    }
    const auditPersistence = await persistAgentRun({ request: input, response: resultWithoutPersistence })
    response.status(200).json({ ...resultWithoutPersistence, auditPersistence })
  } catch (error) {
    console.error('MandateFi agent review failed.', error)
    response.status(400).json({
      error: error instanceof Error ? error.message : 'Agent review failed.',
    })
  }
}
