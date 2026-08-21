import type { AgentReviewRequest } from './agentContracts.js'
import type { SpecialistAgentId, SpecialistReport } from './investmentCommittee.js'

export const SPECIALIST_PROMPT_VERSION = 'mandatefi.specialist.v1'

const roleRules: Record<SpecialistAgentId, string[]> = {
  market: [
    'Assess only spot state, allocation drift, volatility, stablecoin deviation, and portfolio-level market risk.',
    'Do not recommend a specific pool, Farm, Earn product, or transaction route.',
  ],
  liquidity: [
    'Assess only pool depth, volume, fee economics, range risk, impermanent loss, and exit liquidity.',
    'Never treat fee APR as guaranteed yield and never ignore token-pair risk.',
  ],
  farms: [
    'Assess only verified Farm incentives, emissions durability, lock terms, reward-token risk, and exit conditions.',
    'Separate fee APR from incentive APR and flag any missing emissions or MasterChef evidence.',
  ],
  earn: [
    'Assess only verified Earn or vault yield, reward accrual, withdrawal terms, and compounding economics.',
    'Do not infer APY, TVL, lock terms, or withdrawal availability when evidence is missing.',
  ],
  'execution-cost': [
    'Assess only gas, slippage reserve, route price impact, approval overhead, and exit friction.',
    'Block execution when cost evidence is stale, missing, or above the owner mandate ceiling.',
  ],
}

export function buildSpecialistPrompt(
  agentId: SpecialistAgentId,
  report: SpecialistReport,
  context: AgentReviewRequest,
) {
  const evidence = {
    ownerMandate: context.mandate,
    hardGuardrails: context.strategy.guardrails,
    targetAllocations: Object.fromEntries(
      context.strategy.sleeves.map((sleeve) => [sleeve.id, sleeve.allocationBps]),
    ),
    proposedExecution: context.executionPlan,
    activeTriggers: context.activeTriggers,
    specialistEvidence: {
      remit: report.remit,
      status: report.status,
      dataAsOf: report.dataAsOf ?? null,
      deterministicHeadline: report.headline,
      deterministicFindings: report.findings,
      missingInputs: report.missingInputs,
      sourceLabel: report.sourceLabel ?? null,
      sourceUrl: report.sourceUrl ?? null,
      estimatedGrossBenefitBps: report.estimatedGrossBenefitBps,
      estimatedRiskCostBps: report.estimatedRiskCostBps,
    },
  }

  return {
    system: `You are MandateFi's ${report.name}, one independent member of a five-agent DeFi investment committee.

Your scope:
${roleRules[agentId].map((rule) => `- ${rule}`).join('\n')}

Committee rules:
- Analyze only the supplied JSON evidence. Never browse, invent data, or fill missing values from memory.
- Treat mainnet research as opportunity discovery, never as transaction authorization.
- Treat annualized short-window APR as an observed signal, not a forecast or guaranteed return.
- Respect the report's READY, STALE, or UNAVAILABLE evidence status.
- State dissent clearly. Prefer CAUTION or BLOCK when decision-critical evidence is stale or unavailable.
- You provide analysis only. You cannot sign, execute, loosen policy, or create calldata.
- Return strict JSON only. Do not add markdown or commentary outside the JSON object.`,
    user: `Review this JSON evidence and return exactly this JSON shape:
{
  "stance": "SUPPORT" | "NEUTRAL" | "CAUTION" | "BLOCK",
  "confidence": 0,
  "headline": "one concise decision-relevant sentence",
  "findings": ["up to four evidence-based findings"],
  "missingInputs": ["only inputs that are genuinely missing"]
}

Evidence JSON:
${JSON.stringify(evidence, null, 2)}`,
  }
}
