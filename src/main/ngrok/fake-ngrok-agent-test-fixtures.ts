import { EventEmitter } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type { NgrokAgentProcess } from './ngrok-managed-agent'

type FakeEndpoint = { name: string; url: string; upstream: string }

const createEndpointSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  upstream: z.object({ url: z.string() })
})
const createTunnelSchema = z.object({
  name: z.string(),
  addr: z.string(),
  domain: z.string().optional()
})

function fromEndpointBody(body: unknown): FakeEndpoint {
  const record = createEndpointSchema.parse(body)
  return {
    name: record.name,
    url: record.url ?? `https://${record.name}.ngrok.test`,
    upstream: record.upstream.url
  }
}

function fromTunnelBody(body: unknown): FakeEndpoint {
  const record = createTunnelSchema.parse(body)
  return {
    name: record.name,
    url: record.domain ? `https://${record.domain}` : `https://${record.name}.ngrok.test`,
    upstream: record.addr
  }
}

/** An ngrok agent's local API, as captured from ngrok 3.39: endpoint-shaped lists, tunnel-shaped creates. */
export class FakeNgrokAgent {
  readonly endpoints = new Map<string, FakeEndpoint>()
  /** Answer only the pre-endpoints `/api/tunnels` API, like an old agent. */
  legacyOnly = false
  createError: string | null = null
  /** Names its ngrok.yml defines: like the real agent, it refuses to create another by them. */
  configuredNames = new Set<string>()
  /** Reserved URLs online somewhere this agent cannot see, e.g. on another machine. */
  onlineElsewhere = new Set<string>()
  lastCreateBody: unknown = null
  private server: Server | null = null

  address = ''

  async start(): Promise<string> {
    this.server = createServer((request, response) => void this.handle(request, response))
    await new Promise<void>((resolve) => this.server?.listen(0, '127.0.0.1', resolve))
    const bound = this.server.address()
    this.address = `127.0.0.1:${typeof bound === 'object' && bound ? bound.port : 0}`
    return this.address
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve()
    )
    this.server = null
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify(body))
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk))
    }
    const [, , collection, name] = (request.url ?? '').split('/')
    const isEndpoints = collection === 'endpoints'
    if (isEndpoints && this.legacyOnly) {
      response.writeHead(404, { 'Content-Type': 'text/plain' })
      response.end('404 page not found')
      return
    }
    if (request.method === 'GET' && isEndpoints) {
      this.json(response, 200, {
        endpoints: [...this.endpoints.values()].map((endpoint) => ({
          name: endpoint.name,
          url: endpoint.url,
          upstream: { url: endpoint.upstream }
        }))
      })
    } else if (request.method === 'GET' && collection === 'tunnels') {
      this.json(response, 200, {
        tunnels: [...this.endpoints.values()].map((endpoint) => ({
          name: endpoint.name,
          public_url: endpoint.url,
          config: { addr: endpoint.upstream }
        }))
      })
    } else if (request.method === 'POST' && (isEndpoints || collection === 'tunnels')) {
      if (this.createError) {
        this.json(response, 502, {
          error_code: 103,
          status_code: 502,
          msg: 'failed to start tunnel',
          details: { err: this.createError }
        })
        return
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString())
      this.lastCreateBody = body
      const endpoint = isEndpoints ? fromEndpointBody(body) : fromTunnelBody(body)
      if (this.configuredNames.has(endpoint.name) || this.endpoints.has(endpoint.name)) {
        this.json(response, 400, {
          error_code: 103,
          status_code: 400,
          msg: 'invalid endpoint configuration',
          details: { err: `tunnel "${endpoint.name}" already exists` }
        })
        return
      }
      if (this.onlineElsewhere.has(endpoint.url)) {
        this.json(response, 502, {
          error_code: 103,
          status_code: 502,
          msg: 'failed to start tunnel',
          details: {
            err: `failed to start tunnel: The endpoint '${endpoint.url}' is already online.\r\n\r\nERR_NGROK_334\r\n`
          }
        })
        return
      }
      this.endpoints.set(endpoint.name, endpoint)
      this.json(response, 201, {
        name: endpoint.name,
        public_url: endpoint.url,
        config: { addr: endpoint.upstream, inspect: true }
      })
    } else if (request.method === 'DELETE' && name) {
      const removed = this.endpoints.delete(decodeURIComponent(name))
      if (removed) {
        response.writeHead(204)
        response.end()
      } else {
        this.json(response, 404, { error_code: 100, status_code: 404, msg: 'tunnel not found' })
      }
    } else {
      this.json(response, 404, { msg: 'not found' })
    }
  }
}

/** A stand-in for the `ngrok start --none` child that prints what the real agent logs. */
export class FakeAgentProcess extends EventEmitter implements NgrokAgentProcess {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = { end: (): void => {} }
  killed = false

  log(record: Record<string, unknown>): void {
    this.stdout.emit('data', `${JSON.stringify(record)}\n`)
  }

  /** The two lines that make the agent usable: its API address and an established session. */
  comeOnline(address: string): void {
    this.log({ addr: address, lvl: 'info', msg: 'starting web service', obj: 'web' })
    this.log({ lvl: 'info', msg: 'client session established', obj: 'tunnels.session' })
  }

  kill(): boolean {
    this.killed = true
    queueMicrotask(() => this.emit('close'))
    return true
  }
}
