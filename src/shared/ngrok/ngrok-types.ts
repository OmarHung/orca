import { z } from 'zod'

/** A public ngrok endpoint and the local address it forwards to. */
export type NgrokEndpoint = {
  /** The local API address of the agent running it, e.g. `127.0.0.1:4040`. */
  agentAddress: string
  /** Whether Orca's own agent runs it; the rest belong to an ngrok started outside Orca. */
  managed: boolean
  name: string
  publicUrl: string
  /** The upstream as the agent reports it, e.g. `http://localhost:5173`. */
  upstream: string
  /** The port it forwards to on this machine; null for an upstream on another host. */
  upstreamPort: number | null
}

/** An endpoint defined in ngrok.yml, which `ngrok start <name>` would bring up. */
export type NgrokConfiguredEndpoint = {
  name: string
  /** Its reserved URL, e.g. the account's dev domain; null lets ngrok pick one. */
  url: string | null
  upstream: string
  upstreamPort: number | null
  /** Whether an agent on this machine already serves it. */
  online: boolean
}

export type NgrokAgentStatus =
  | { state: 'stopped'; error: string | null }
  | { state: 'starting' }
  | { state: 'online'; address: string }

export type NgrokSnapshot = {
  /** Whether an ngrok binary was found on this machine. */
  installed: boolean
  /** Orca's own agent, started on the first share. */
  agent: NgrokAgentStatus
  endpoints: NgrokEndpoint[]
  /** API addresses of agents started outside Orca, e.g. `ngrok http 3000` in a terminal. */
  externalAgents: string[]
  /** Endpoints ngrok.yml defines; a share of their port uses them. */
  configured: NgrokConfiguredEndpoint[]
}

export type NgrokResult<T> = { ok: true; value: T } | { ok: false; error: string }

export const NGROK_LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1'] as const

const portSchema = z.number().int().min(1).max(65_535)

// Why loopback only: a share publishes the upstream to the internet, so it must stay on this machine.
export const ngrokShareRequestSchema = z.object({
  port: portSchema,
  protocol: z.enum(['http', 'https']),
  host: z.enum(NGROK_LOOPBACK_HOSTS)
})
export type NgrokShareRequest = z.infer<typeof ngrokShareRequestSchema>

export const ngrokStopRequestSchema = z.object({
  agentAddress: z.string().min(1).max(64),
  name: z.string().min(1).max(200)
})
export type NgrokStopRequest = z.infer<typeof ngrokStopRequestSchema>

export const ngrokEndpointNameSchema = z.string().min(1).max(200)

/** Ports of listeners whose process is ngrok, each a candidate agent API to ask. */
export const ngrokAgentPortsSchema = z.array(portSchema).max(16)

const LOOPBACK_UPSTREAM_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/** The local port an upstream such as `http://localhost:5016`, `localhost:5016` or `5016` reaches. */
export function ngrokUpstreamPort(upstream: string): number | null {
  const text = upstream.trim()
  if (/^\d{1,5}$/.test(text)) {
    const port = Number(text)
    return port >= 1 && port <= 65_535 ? port : null
  }
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`)
  } catch {
    return null
  }
  if (!LOOPBACK_UPSTREAM_HOSTS.has(url.hostname.toLowerCase())) {
    return null
  }
  if (url.port) {
    return Number(url.port)
  }
  return url.protocol === 'https:' ? 443 : url.protocol === 'http:' ? 80 : null
}
