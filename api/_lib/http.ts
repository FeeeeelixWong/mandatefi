export type ApiRequest = {
  method?: string
  body?: unknown
  headers: Record<string, string | string[] | undefined>
}

export type ApiResponse = {
  status: (statusCode: number) => ApiResponse
  setHeader: (name: string, value: string) => void
  json: (body: unknown) => void
  end: () => void
}

type RequestOptions = {
  requireBrowserOrigin?: boolean
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function configureRequest(
  request: ApiRequest,
  response: ApiResponse,
  options: RequestOptions = {},
) {
  const origin = headerValue(request.headers.origin)
  const configured = (process.env.MANDATEFI_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const deploymentOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
  const allowedOrigins = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'https://feeeeelixwong.github.io',
    'https://mandatefi-ten.vercel.app',
    deploymentOrigin,
    ...configured,
  ].filter(Boolean))

  if (options.requireBrowserOrigin && process.env.VERCEL_ENV === 'production' && !origin) {
    response.status(403).json({ error: 'A trusted browser origin is required.' })
    return false
  }

  if (origin && !allowedOrigins.has(origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' })
    return false
  }

  if (origin) response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Vary', 'Origin')

  if (request.method === 'OPTIONS') {
    response.status(204).end()
    return false
  }
  return true
}

export function parseBody(body: unknown) {
  if (typeof body === 'string') return JSON.parse(body) as unknown
  return body
}
