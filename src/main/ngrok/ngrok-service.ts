import {
  ngrokUpstreamPort,
  type NgrokEndpoint,
  type NgrokShareRequest,
  type NgrokSnapshot,
  type NgrokStopRequest
} from '../../shared/ngrok/ngrok-types'
import {
  createNgrokEndpoint,
  createNgrokFromDefinition,
  deleteNgrokEndpoint,
  isLoopbackAgentAddress,
  listNgrokEndpoints,
  type NgrokApiEndpoint
} from './ngrok-agent-api'
import { configuredForShare } from '../../shared/ngrok/ngrok-reserved-url'
import {
  configuredEndpointAgentName,
  lendConfigEndpoint,
  parseNgrokConfigEndpoints,
  type NgrokConfigEndpoint
} from './ngrok-config'
import { NgrokManagedAgent, type NgrokAgentProcess } from './ngrok-managed-agent'

export const NGROK_NOT_INSTALLED =
  'ngrok is not installed. Install it from https://ngrok.com/download, then run `ngrok config add-authtoken <token>` once.'

const MANAGED_NAME_PREFIX = 'orca-'

export type NgrokServiceDeps = {
  resolvePath: () => Promise<string | null>
  spawnAgent: (ngrokPath: string) => NgrokAgentProcess
  /** Orca's agent or its endpoints changed. */
  onChange: () => void
  /** The ngrok.yml the binary uses; null when there is none. */
  readConfigText?: (ngrokPath: string) => Promise<string | null>
  fetchImpl?: typeof fetch
  startTimeoutMs?: number
}

/** What Orca asks its agent to bring up: the name it runs under, and how to create it. */
type EndpointPlan = {
  name: string
  create: (address: string) => Promise<NgrokApiEndpoint>
}

function portOfAddress(address: string): number | null {
  const port = Number(address.slice(address.lastIndexOf(':') + 1))
  return Number.isInteger(port) ? port : null
}

function sameUrl(left: string, right: string): boolean {
  const normalize = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase()
  return normalize(left) === normalize(right)
}

/** Whether `endpoint` is ngrok.yml's `configured` one, e.g. from `ngrok start 5016` in a terminal. */
function servesConfigured(endpoint: NgrokEndpoint, configured: NgrokConfigEndpoint): boolean {
  return (
    endpoint.name === configured.name ||
    endpoint.name === configuredEndpointAgentName(configured.name) ||
    (configured.url !== null && sameUrl(endpoint.publicUrl, configured.url))
  )
}

function toEndpoint(agentAddress: string, managed: boolean, api: NgrokApiEndpoint): NgrokEndpoint {
  return {
    agentAddress,
    managed,
    name: api.name,
    publicUrl: api.publicUrl,
    upstream: api.upstream,
    upstreamPort: ngrokUpstreamPort(api.upstream)
  }
}

function isAlreadyOnline(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('ERR_NGROK_334') || message.includes('already online')
}

export class NgrokService {
  private readonly agent: NgrokManagedAgent
  /** Agents started outside Orca, as of the last snapshot; a reserved URL may be online there. */
  private externalAddresses: string[] = []

  constructor(private readonly deps: NgrokServiceDeps) {
    this.agent = new NgrokManagedAgent({
      spawn: async () => {
        const ngrokPath = await deps.resolvePath()
        if (!ngrokPath) {
          throw new Error(NGROK_NOT_INSTALLED)
        }
        return deps.spawnAgent(ngrokPath)
      },
      onStatus: () => deps.onChange(),
      startTimeoutMs: deps.startTimeoutMs
    })
  }

  private managedAddress(): string | null {
    const status = this.agent.getStatus()
    return status.state === 'online' ? status.address : null
  }

  private async listOrNull(address: string, managed: boolean): Promise<NgrokEndpoint[] | null> {
    try {
      const endpoints = await listNgrokEndpoints(address, this.deps.fetchImpl)
      return endpoints.map((endpoint) => toEndpoint(address, managed, endpoint))
    } catch {
      return null
    }
  }

  /** Orca's agent plus whichever of `agentPorts` (listeners whose process is ngrok) answer. */
  async snapshot(agentPorts: readonly number[]): Promise<NgrokSnapshot> {
    const managedAddress = this.managedAddress()
    const managedPort = managedAddress ? portOfAddress(managedAddress) : null
    const externalAddresses = [...new Set(agentPorts)]
      .filter((port) => port !== managedPort)
      .map((port) => `127.0.0.1:${port}`)
    const [ngrokPath, managed, ...external] = await Promise.all([
      this.deps.resolvePath(),
      managedAddress ? this.listOrNull(managedAddress, true) : Promise.resolve([]),
      ...externalAddresses.map((address) => this.listOrNull(address, false))
    ])
    const externalAgents = externalAddresses.filter((_, index) => external[index] !== null)
    this.externalAddresses = externalAgents
    const endpoints = [...(managed ?? []), ...external.flatMap((list) => list ?? [])]
    // Why field by field: a definition's `request` can hold credentials the renderer must not get.
    const configured = (await this.configEndpoints(ngrokPath)).map((definition) => ({
      name: definition.name,
      url: definition.url,
      upstream: definition.upstream,
      upstreamPort: definition.upstreamPort,
      online: endpoints.some((endpoint) => servesConfigured(endpoint, definition))
    }))
    return {
      installed: ngrokPath !== null,
      agent: this.agent.getStatus(),
      endpoints,
      externalAgents,
      configured
    }
  }

  private async configEndpoints(ngrokPath: string | null): Promise<NgrokConfigEndpoint[]> {
    if (!ngrokPath || !this.deps.readConfigText) {
      return []
    }
    try {
      const text = await this.deps.readConfigText(ngrokPath)
      return text ? parseNgrokConfigEndpoints(text) : []
    } catch {
      return []
    }
  }

  /** Every endpoint up on this machine: Orca's agent's and those of agents started outside it. */
  private async onlineEndpoints(): Promise<NgrokEndpoint[]> {
    const managedAddress = this.managedAddress()
    const lists = await Promise.all([
      managedAddress ? this.listOrNull(managedAddress, true) : Promise.resolve([]),
      ...this.externalAddresses.map((address) => this.listOrNull(address, false))
    ])
    return lists.flatMap((list) => list ?? [])
  }

  /**
   * Shares a local port through Orca's agent. ngrok.yml's endpoint for the port wins; else a
   * reserved URL nothing serves goes to this port, so the first share gets the fixed URL; else
   * ngrok picks a random one. A port already shared keeps its endpoint.
   */
  async share(request: NgrokShareRequest): Promise<NgrokEndpoint> {
    const host = request.host === '::1' ? '[::1]' : request.host
    const upstream = `${request.protocol}://${host}:${request.port}`
    const name = `${MANAGED_NAME_PREFIX}${request.port}`
    const random: EndpointPlan = {
      name,
      create: (address) => createNgrokEndpoint(address, { name, upstream }, this.deps.fetchImpl)
    }
    const [definitions, online] = await Promise.all([
      this.configEndpoints(await this.deps.resolvePath()),
      this.onlineEndpoints()
    ])
    const pick = configuredForShare(
      definitions.map((definition) => ({
        ...definition,
        online: online.some((endpoint) => servesConfigured(endpoint, definition))
      })),
      request.port
    )
    if (!pick) {
      return this.bringUp(random)
    }
    const plan: EndpointPlan = pick.borrowed
      ? {
          name,
          create: (address) =>
            createNgrokFromDefinition(
              address,
              lendConfigEndpoint(pick.entry, name, upstream),
              this.deps.fetchImpl
            )
        }
      : this.planFromConfig(pick.entry)
    try {
      return await this.bringUp(plan)
    } catch (error) {
      // Why: the reserved URL can be online where Orca cannot see, e.g. on another machine.
      if (isAlreadyOnline(error)) {
        return this.bringUp(random)
      }
      throw error
    }
  }

  /** What `ngrok start <name>` does, through Orca's agent. */
  async startConfigured(name: string): Promise<NgrokEndpoint> {
    const configured = (await this.configEndpoints(await this.deps.resolvePath())).find(
      (definition) => definition.name === name
    )
    if (!configured) {
      throw new Error(`ngrok.yml has no endpoint named "${name}"`)
    }
    return this.bringUp(this.planFromConfig(configured))
  }

  private planFromConfig(configured: NgrokConfigEndpoint): EndpointPlan {
    return {
      name: configuredEndpointAgentName(configured.name),
      create: (address) =>
        createNgrokFromDefinition(address, configured.request, this.deps.fetchImpl)
    }
  }

  private async bringUp(plan: EndpointPlan): Promise<NgrokEndpoint> {
    const address = await this.agent.ensureStarted()
    try {
      const existing = (await listNgrokEndpoints(address, this.deps.fetchImpl)).find(
        (endpoint) => endpoint.name === plan.name
      )
      const endpoint = existing ?? (await plan.create(address))
      return toEndpoint(address, true, endpoint)
    } catch (error) {
      await this.stopAgentIfIdle(address)
      throw error
    } finally {
      this.deps.onChange()
    }
  }

  async stopEndpoint(request: NgrokStopRequest): Promise<void> {
    if (!isLoopbackAgentAddress(request.agentAddress)) {
      throw new Error('That ngrok agent is not on this machine')
    }
    await deleteNgrokEndpoint(request.agentAddress, request.name, this.deps.fetchImpl)
    if (request.agentAddress === this.managedAddress()) {
      await this.stopAgentIfIdle(request.agentAddress)
    }
    this.deps.onChange()
  }

  stopAgent(): void {
    this.agent.stop()
  }

  // Why: an idle agent still holds one of the account's few concurrent agent sessions.
  private async stopAgentIfIdle(address: string): Promise<void> {
    const remaining = await this.listOrNull(address, true)
    if (remaining?.length === 0 && this.managedAddress() === address) {
      this.agent.stop()
    }
  }
}
