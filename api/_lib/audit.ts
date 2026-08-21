import { neon } from '@neondatabase/serverless'
import type { AgentReviewRequest, AgentReviewResponse } from '../../src/domain/agentContracts.js'

type AuditRecord = {
  request: AgentReviewRequest
  response: Omit<AgentReviewResponse, 'auditPersistence'>
}

export async function persistAgentRun(record: AuditRecord): Promise<'postgres' | 'vercel-log'> {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.log(JSON.stringify({
      event: 'mandatefi.agent-review',
      runId: record.response.runId,
      inputHash: record.response.inputHash,
      modelMode: record.response.modelMode,
      source: record.request.source,
      generatedAt: record.response.generatedAt,
    }))
    return 'vercel-log'
  }

  try {
    const sql = neon(databaseUrl)
    await sql`
      CREATE TABLE IF NOT EXISTS mandatefi_agent_runs (
        run_id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL,
        input_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        model_mode TEXT NOT NULL,
        manager_model TEXT NOT NULL,
        request_payload JSONB NOT NULL,
        response_payload JSONB NOT NULL
      )
    `
    await sql`
      INSERT INTO mandatefi_agent_runs (
        run_id, created_at, input_hash, source, model_mode, manager_model,
        request_payload, response_payload
      ) VALUES (
        ${record.response.runId}, ${record.response.generatedAt}, ${record.response.inputHash},
        ${record.request.source}, ${record.response.modelMode}, ${record.response.managerModel},
        ${JSON.stringify(record.request)}, ${JSON.stringify(record.response)}
      )
      ON CONFLICT (run_id) DO NOTHING
    `
    return 'postgres'
  } catch (error) {
    console.error('MandateFi audit persistence failed.', error)
    return 'vercel-log'
  }
}
