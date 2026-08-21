import { configureRequest, type ApiRequest, type ApiResponse } from './_lib/http.js'

export default function handler(request: ApiRequest, response: ApiResponse) {
  if (!configureRequest(request, response)) return
  if (request.method !== 'GET') {
    response.status(405).json({ error: 'Method not allowed.' })
    return
  }
  response.status(200).json({
    service: 'mandatefi-agent-runtime',
    status: 'ok',
    deepseekConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
    specialistModel: process.env.DEEPSEEK_SPECIALIST_MODEL ?? 'deepseek-v4-flash',
    managerModel: process.env.DEEPSEEK_MANAGER_MODEL ?? 'deepseek-v4-pro',
    auditPersistence: process.env.DATABASE_URL ? 'postgres' : 'vercel-log',
  })
}
