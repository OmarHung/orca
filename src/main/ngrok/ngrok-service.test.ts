import { createServer } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeAgentProcess, FakeNgrokAgent } from './fake-ngrok-agent-test-fixtures'
import { NGROK_NOT_INSTALLED, NgrokService } from './ngrok-service'

let managed: FakeNgrokAgent
let external: FakeNgrokAgent
let children: FakeAgentProcess[]
let changes: number

function createService(
  ngrokPath: string | null = '/opt/homebrew/bin/ngrok',
  configText: string | null = null
): NgrokService {
  return new NgrokService({
    resolvePath: async () => ngrokPath,
    readConfigText: async () => configText,
    spawnAgent: () => {
      const child = new FakeAgentProcess()
      children.push(child)
      // Why a macrotask: the agent attaches its output listeners after spawn returns.
      setTimeout(() => child.comeOnline(managed.address), 0)
      return child
    },
    onChange: () => {
      changes += 1
    }
  })
}

beforeEach(async () => {
  managed = new FakeNgrokAgent()
  external = new FakeNgrokAgent()
  await managed.start()
  await external.start()
  children = []
  changes = 0
})

afterEach(async () => {
  await managed.stop()
  await external.stop()
})

describe('NgrokService', () => {
  it("shares a port through Orca's agent and reuses the endpoint on a second share", async () => {
    const service = createService()
    const request = { port: 5173, protocol: 'http', host: 'localhost' } as const
    const shared = await service.share(request)
    expect(shared).toEqual({
      agentAddress: managed.address,
      managed: true,
      name: 'orca-5173',
      publicUrl: 'https://orca-5173.ngrok.test',
      upstream: 'http://localhost:5173',
      upstreamPort: 5173
    })
    expect(await service.share(request)).toEqual(shared)
    expect(managed.endpoints.size).toBe(1)
    expect(children).toHaveLength(1)
    expect(changes).toBeGreaterThan(0)
  })

  it('brackets an IPv6 loopback upstream', async () => {
    const service = createService()
    const shared = await service.share({ port: 7016, protocol: 'https', host: '::1' })
    expect(shared.upstream).toBe('https://[::1]:7016')
  })

  it('stops the idle agent after its last endpoint stops, or after a failed first share', async () => {
    const service = createService()
    const shared = await service.share({ port: 3000, protocol: 'http', host: 'localhost' })
    await service.stopEndpoint({ agentAddress: shared.agentAddress, name: shared.name })
    expect(children[0].killed).toBe(true)

    managed.createError = 'failed to start tunnel: limit reached\r\n\r\nERR_NGROK_324\r\n'
    await expect(
      service.share({ port: 3001, protocol: 'http', host: 'localhost' })
    ).rejects.toThrow('failed to start tunnel: limit reached (ERR_NGROK_324)')
    expect(children[1].killed).toBe(true)
  })

  it('lists endpoints of agents started outside Orca and skips ports that are not agents', async () => {
    external.endpoints.set('5016', {
      name: '5016',
      url: 'https://lorelai.ngrok-free.dev',
      upstream: 'http://localhost:5016'
    })
    // A dev server that answers every path with HTML is not an agent.
    const page = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<!doctype html><title>app</title>')
    })
    await new Promise<void>((resolve) => page.listen(0, '127.0.0.1', resolve))
    const pageAddress = page.address()
    const pagePort = typeof pageAddress === 'object' && pageAddress ? pageAddress.port : 0
    const externalPort = Number(external.address.split(':')[1])

    const snapshot = await createService().snapshot([externalPort, pagePort, externalPort])
    await new Promise<void>((resolve) => page.close(() => resolve()))
    expect(snapshot).toEqual({
      installed: true,
      agent: { state: 'stopped', error: null },
      endpoints: [
        {
          agentAddress: external.address,
          managed: false,
          name: '5016',
          publicUrl: 'https://lorelai.ngrok-free.dev',
          upstream: 'http://localhost:5016',
          upstreamPort: 5016
        }
      ],
      externalAgents: [external.address],
      configured: []
    })
  })

  it('stops an endpoint on an external agent and refuses one off this machine', async () => {
    external.endpoints.set('web', { name: 'web', url: 'https://w.test', upstream: '3000' })
    const service = createService()
    await service.stopEndpoint({ agentAddress: external.address, name: 'web' })
    expect(external.endpoints.size).toBe(0)
    await expect(
      service.stopEndpoint({ agentAddress: '10.0.0.2:4040', name: 'web' })
    ).rejects.toThrow('not on this machine')
  })

  it('explains how to install ngrok when it is missing', async () => {
    const service = createService(null)
    await expect(service.share({ port: 80, protocol: 'http', host: 'localhost' })).rejects.toThrow(
      NGROK_NOT_INSTALLED
    )
    expect((await service.snapshot([])).installed).toBe(false)
  })

  it("shares a port as ngrok.yml's endpoint for it, at its reserved URL", async () => {
    // Like the real agent, Orca's loads ngrok.yml and so already holds the name `5016`.
    managed.configuredNames.add('5016')
    const service = createService(
      undefined,
      'endpoints:\n  - name: 5016\n    url: https://lorelai.ngrok-free.dev\n    upstream:\n      url: 5016\n    traffic_policy:\n      on_http_request: []\n'
    )
    const before = await service.snapshot([])
    // Field by field: the definition (with any credentials) never reaches the renderer.
    expect(before.configured).toEqual([
      {
        name: '5016',
        url: 'https://lorelai.ngrok-free.dev',
        upstream: '5016',
        upstreamPort: 5016,
        online: false
      }
    ])

    const shared = await service.share({ port: 5016, protocol: 'http', host: '::1' })
    expect(shared).toMatchObject({
      name: 'orca-config-5016',
      publicUrl: 'https://lorelai.ngrok-free.dev',
      upstream: '5016'
    })
    expect(managed.lastCreateBody).toMatchObject({ traffic_policy: { on_http_request: [] } })
    expect((await service.snapshot([])).configured[0].online).toBe(true)

    // Stopped and shared again: the same name works a second time.
    await service.stopEndpoint({ agentAddress: shared.agentAddress, name: shared.name })
    expect(await service.share({ port: 5016, protocol: 'http', host: '::1' })).toMatchObject({
      publicUrl: 'https://lorelai.ngrok-free.dev'
    })
  })

  it('starts a configured endpoint by name, like `ngrok start <name>`', async () => {
    managed.configuredNames.add('web')
    const service = createService(
      undefined,
      'tunnels:\n  web:\n    proto: http\n    addr: 3000\n    domain: web.ngrok.dev\n'
    )
    const started = await service.startConfigured('web')
    expect(started).toMatchObject({ publicUrl: 'https://web.ngrok.dev', upstreamPort: 3000 })
    await expect(service.startConfigured('missing')).rejects.toThrow(
      'ngrok.yml has no endpoint named "missing"'
    )
  })

  it("counts a configured endpoint another agent serves, e.g. a terminal's `ngrok start`", async () => {
    external.endpoints.set('5016', {
      name: '5016',
      url: 'https://lorelai.ngrok-free.dev',
      upstream: 'http://localhost:5016'
    })
    const service = createService(
      undefined,
      'endpoints:\n  - name: api\n    url: https://lorelai.ngrok-free.dev/\n    upstream:\n      url: 5016\n'
    )
    const snapshot = await service.snapshot([Number(external.address.split(':')[1])])
    expect(snapshot.configured.map((configured) => configured.online)).toEqual([true])
  })

  it('lends the free reserved URL to the first port shared, and a random one to the next', async () => {
    managed.configuredNames.add('5016')
    const service = createService(
      undefined,
      'endpoints:\n  - name: 5016\n    url: https://lorelai.ngrok-free.dev\n    upstream:\n      url: 5016\n      protocol: http2\n    traffic_policy:\n      on_http_request: []\n'
    )
    const first = await service.share({ port: 7182, protocol: 'https', host: 'localhost' })
    expect(first).toMatchObject({
      name: 'orca-7182',
      publicUrl: 'https://lorelai.ngrok-free.dev',
      upstream: 'https://localhost:7182'
    })
    // Its traffic policy comes along; the upstream (and its protocol) is this port's.
    expect(managed.lastCreateBody).toEqual({
      name: 'orca-7182',
      url: 'https://lorelai.ngrok-free.dev',
      traffic_policy: { on_http_request: [] },
      upstream: { url: 'https://localhost:7182' }
    })

    const second = await service.share({ port: 5016, protocol: 'http', host: 'localhost' })
    expect(second.publicUrl).toBe('https://orca-5016.ngrok.test')

    // Released, the reserved URL goes to the next share.
    await service.stopEndpoint({ agentAddress: first.agentAddress, name: first.name })
    const third = await service.share({ port: 3000, protocol: 'http', host: 'localhost' })
    expect(third.publicUrl).toBe('https://lorelai.ngrok-free.dev')
  })

  it('takes a random URL when the reserved one is online where Orca cannot see', async () => {
    managed.configuredNames.add('5016')
    managed.onlineElsewhere.add('https://lorelai.ngrok-free.dev')
    const service = createService(
      undefined,
      'endpoints:\n  - name: 5016\n    url: https://lorelai.ngrok-free.dev\n    upstream:\n      url: 5016\n'
    )
    const shared = await service.share({ port: 5016, protocol: 'http', host: 'localhost' })
    expect(shared).toMatchObject({ name: 'orca-5016', publicUrl: 'https://orca-5016.ngrok.test' })
  })

  it("leaves a terminal's `ngrok start` its reserved URL", async () => {
    external.endpoints.set('5016', {
      name: '5016',
      url: 'https://lorelai.ngrok-free.dev',
      upstream: 'http://localhost:5016'
    })
    const service = createService(
      undefined,
      'endpoints:\n  - name: 5016\n    url: https://lorelai.ngrok-free.dev\n    upstream:\n      url: 5016\n'
    )
    // The snapshot is how Orca learns of agents started outside it.
    await service.snapshot([Number(external.address.split(':')[1])])
    const shared = await service.share({ port: 7182, protocol: 'http', host: 'localhost' })
    expect(shared.publicUrl).toBe('https://orca-7182.ngrok.test')
  })
})
