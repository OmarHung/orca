import { getMainHttpClient } from '../network/http-client'
import { ensureElectronProxyFromEnvironment } from '../network/proxy-settings'
import {
  MONDAY_API_URL,
  MONDAY_API_VERSION,
  type MondayErrorKind
} from '../../shared/monday/monday-types'

/** Longest rate-limit wait Orca sits through before reporting the error instead. */
const MAX_RETRY_WAIT_SECONDS = 30

export class MondayApiError extends Error {
  constructor(
    readonly kind: MondayErrorKind,
    message: string,
    readonly retryInSeconds: number | null = null
  ) {
    super(message)
    this.name = 'MondayApiError'
  }
}

type GraphqlErrorEntry = {
  message?: string
  extensions?: { code?: string; retry_in_seconds?: number; status_code?: number }
}

type GraphqlBody<T> = {
  data?: T
  errors?: GraphqlErrorEntry[]
  // Pre-2025 error envelope, still returned for some failures.
  error_code?: string
  error_message?: string
  status_code?: number
}

const UNAUTHORIZED_CODES = new Set([
  'USER_UNAUTHORIZED',
  'UserUnauthorizedException',
  'Unauthorized'
])
const RATE_LIMIT_CODES = new Set([
  'RATE_LIMIT_EXCEEDED',
  'COMPLEXITY_BUDGET_EXHAUSTED',
  'ComplexityException',
  'IP_RATE_LIMIT_EXCEEDED',
  'maxConcurrencyExceeded',
  'CONCURRENCY_LIMIT_EXCEEDED'
])

function retryAfterSeconds(response: Response, entry: GraphqlErrorEntry | null): number | null {
  const fromBody = entry?.extensions?.retry_in_seconds
  if (typeof fromBody === 'number' && Number.isFinite(fromBody)) {
    return fromBody
  }
  const header = Number(response.headers.get('retry-after'))
  return Number.isFinite(header) && header > 0 ? header : null
}

export function classifyMondayFailure<T>(
  response: Response,
  body: GraphqlBody<T> | null
): MondayApiError | null {
  const entry = body?.errors?.[0] ?? null
  const code = entry?.extensions?.code ?? body?.error_code ?? ''
  const message = entry?.message ?? body?.error_message ?? ''
  if (
    response.status === 401 ||
    UNAUTHORIZED_CODES.has(code) ||
    /not authenticated/i.test(message)
  ) {
    return new MondayApiError('unauthorized', 'The monday token was rejected.')
  }
  if (code === 'DAILY_LIMIT_EXCEEDED') {
    return new MondayApiError('daily-limit', 'The daily monday API limit is used up.')
  }
  if (response.status === 429 || RATE_LIMIT_CODES.has(code) || /rate limit/i.test(message)) {
    return new MondayApiError(
      'rate-limited',
      message || 'monday is rate limiting requests.',
      retryAfterSeconds(response, entry)
    )
  }
  if (message) {
    return new MondayApiError('api', message)
  }
  if (!response.ok || !body?.data) {
    return new MondayApiError('api', `monday returned HTTP ${response.status}.`)
  }
  return null
}

export type MondayGraphqlOptions = {
  endpoint?: string
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}

async function postOnce<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  options: MondayGraphqlOptions
): Promise<T> {
  const endpoint = options.endpoint ?? MONDAY_API_URL
  const httpClient = getMainHttpClient()
  const proxySession = httpClient.proxySession()
  await ensureElectronProxyFromEnvironment({
    ...(proxySession ? { proxySession } : {}),
    probeUrl: endpoint
  }).catch(() => undefined)
  let response: Response
  try {
    response = await httpClient.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: token,
        'API-Version': MONDAY_API_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables }),
      signal: options.signal
    })
  } catch (error) {
    throw new MondayApiError(
      'network',
      `Could not reach monday: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const body = await response
    .json()
    .then((parsed: GraphqlBody<T>) => parsed)
    .catch(() => null)
  const failure = classifyMondayFailure(response, body)
  if (failure) {
    throw failure
  }
  if (body?.data === undefined) {
    throw new MondayApiError('api', `monday returned HTTP ${response.status}.`)
  }
  return body.data
}

/** One GraphQL call; a rate-limited call is retried once after monday's suggested wait. */
export async function mondayGraphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
  options: MondayGraphqlOptions = {}
): Promise<T> {
  try {
    return await postOnce<T>(token, query, variables, options)
  } catch (error) {
    const wait = error instanceof MondayApiError ? error.retryInSeconds : null
    if (!(error instanceof MondayApiError) || error.kind !== 'rate-limited' || wait === null) {
      throw error
    }
    if (wait > MAX_RETRY_WAIT_SECONDS || options.signal?.aborted) {
      throw error
    }
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    await sleep(Math.max(wait, 1) * 1000)
    return postOnce<T>(token, query, variables, options)
  }
}
