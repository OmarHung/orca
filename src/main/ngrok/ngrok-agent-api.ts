import { z } from 'zod'
import { describeNgrokError } from './ngrok-agent-log'

const READ_TIMEOUT_MS = 2_000
// Why longer: creating an endpoint waits for ngrok's servers to bring it online.
const WRITE_TIMEOUT_MS = 20_000

/** An endpoint as one agent's local API reports it. */
export type NgrokApiEndpoint = { name: string; publicUrl: string; upstream: string }

export class NgrokApiError extends Error {}

const endpointSchema = z.object({
  name: z.string(),
  url: z.string(),
  upstream: z.object({ url: z.string() })
})
// Why both: GET /api/endpoints lists endpoints, but POST answers in the older tunnel shape, and
// agents older than the endpoints API only have /api/tunnels.
const tunnelSchema = z.object({
  name: z.string(),
  public_url: z.string(),
  config: z.object({ addr: z.string() })
})
const endpointListSchema = z.object({ endpoints: z.array(endpointSchema) })
const tunnelListSchema = z.object({ tunnels: z.array(tunnelSchema) })
const errorSchema = z.object({
  msg: z.string().optional(),
  details: z.object({ err: z.string().optional() }).optional()
})

function fromEndpoint(endpoint: z.infer<typeof endpointSchema>): NgrokApiEndpoint {
  return { name: endpoint.name, publicUrl: endpoint.url, upstream: endpoint.upstream.url }
}

function fromTunnel(tunnel: z.infer<typeof tunnelSchema>): NgrokApiEndpoint {
  return { name: tunnel.name, publicUrl: tunnel.public_url, upstream: tunnel.config.addr }
}

const LOOPBACK_ADDRESS = /^(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})$/

/** Whether `address` is an agent API on this machine; nothing else is ever called. */
export function isLoopbackAgentAddress(address: string): boolean {
  const port = Number(LOOPBACK_ADDRESS.exec(address)?.[1])
  return port >= 1 && port <= 65_535
}

type Fetch = typeof fetch

async function request(
  fetchImpl: Fetch,
  address: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'DELETE'; body?: unknown; timeoutMs?: number }
): Promise<{ status: number; body: unknown }> {
  if (!isLoopbackAgentAddress(address)) {
    throw new NgrokApiError(`Not a local ngrok agent address: ${address}`)
  }
  const response = await fetchImpl(`http://${address}${path}`, {
    method: init.method,
    redirect: 'manual',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? READ_TIMEOUT_MS)
  })
  // Why the type check: a port that is not ngrok's may answer any path with a large HTML page.
  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  const body: unknown = isJson && response.status !== 204 ? await response.json() : null
  return { status: response.status, body }
}

function errorMessage(body: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(body)
  const detail = parsed.success ? (parsed.data.details?.err ?? parsed.data.msg) : undefined
  return detail ? describeNgrokError(detail) : fallback
}

/** The agent's endpoints; throws when `address` does not answer like an ngrok agent. */
export async function listNgrokEndpoints(
  address: string,
  fetchImpl: Fetch = fetch
): Promise<NgrokApiEndpoint[]> {
  const endpoints = await request(fetchImpl, address, '/api/endpoints', { method: 'GET' })
  const parsedEndpoints = endpointListSchema.safeParse(endpoints.body)
  if (endpoints.status === 200 && parsedEndpoints.success) {
    return parsedEndpoints.data.endpoints.map(fromEndpoint)
  }
  const tunnels = await request(fetchImpl, address, '/api/tunnels', { method: 'GET' })
  const parsedTunnels = tunnelListSchema.safeParse(tunnels.body)
  if (tunnels.status === 200 && parsedTunnels.success) {
    return parsedTunnels.data.tunnels.map(fromTunnel)
  }
  throw new NgrokApiError(`${address} is not an ngrok agent`)
}

/** Creates an endpoint from a full definition, posted to `/api/endpoints` or the older `/api/tunnels`. */
export async function createNgrokFromDefinition(
  address: string,
  definition: { api: 'endpoints' | 'tunnels'; body: Record<string, unknown> },
  fetchImpl: Fetch = fetch
): Promise<NgrokApiEndpoint> {
  const response = await request(fetchImpl, address, `/api/${definition.api}`, {
    method: 'POST',
    body: definition.body,
    timeoutMs: WRITE_TIMEOUT_MS
  })
  if (response.status !== 200 && response.status !== 201) {
    throw new NgrokApiError(errorMessage(response.body, `ngrok answered ${response.status}`))
  }
  const asTunnel = tunnelSchema.safeParse(response.body)
  if (asTunnel.success) {
    return fromTunnel(asTunnel.data)
  }
  const asEndpoint = endpointSchema.safeParse(response.body)
  if (asEndpoint.success) {
    return fromEndpoint(asEndpoint.data)
  }
  throw new NgrokApiError('ngrok started the endpoint but did not say its public URL')
}

export function createNgrokEndpoint(
  address: string,
  endpoint: { name: string; upstream: string },
  fetchImpl: Fetch = fetch
): Promise<NgrokApiEndpoint> {
  // Why no url: ngrok then picks one, a random URL or the free plan's dev domain.
  return createNgrokFromDefinition(
    address,
    { api: 'endpoints', body: { name: endpoint.name, upstream: { url: endpoint.upstream } } },
    fetchImpl
  )
}

/** Stops one endpoint; one that is already gone counts as stopped. */
export async function deleteNgrokEndpoint(
  address: string,
  name: string,
  fetchImpl: Fetch = fetch
): Promise<void> {
  const path = encodeURIComponent(name)
  const options = { method: 'DELETE', timeoutMs: WRITE_TIMEOUT_MS } as const
  const response = await request(fetchImpl, address, `/api/endpoints/${path}`, options)
  if (response.status === 204 || response.status === 200) {
    return
  }
  if (response.status === 404) {
    // Why: agents older than the endpoints API know it only as a tunnel.
    const legacy = await request(fetchImpl, address, `/api/tunnels/${path}`, options)
    if (legacy.status === 204 || legacy.status === 200 || legacy.status === 404) {
      return
    }
    throw new NgrokApiError(errorMessage(legacy.body, `ngrok answered ${legacy.status}`))
  }
  throw new NgrokApiError(errorMessage(response.body, `ngrok answered ${response.status}`))
}
