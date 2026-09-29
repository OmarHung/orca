import { EventEmitter } from 'node:events'
import { connect } from 'node:net'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { SshVpnStatus } from '../../shared/ssh-vpn-types'
import type { SshVpnDatabaseRoutes } from '../ssh-vpn/ssh-vpn-database-route'
import type { SshVpnRoute } from '../ssh-vpn/ssh-vpn-manager-types'
import {
  createDatabaseVpnTunnelOpener,
  type DatabaseVpnTunnelDeps,
  type VpnPipeProcess
} from './database-vpn-tunnel'

const ROUTE: SshVpnRoute = { dockerPath: '/usr/local/bin/docker', containerName: 'orca-ssh-vpn-a' }

/** Stands in for `docker exec … nc`: echoes what it is sent and exits once its stdin ends. */
function echoPipe(): VpnPipeProcess & { stdinEnded: () => boolean } {
  const events = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  let ended = false
  stdin.pipe(stdout)
  stdin.on('end', () => {
    ended = true
    setImmediate(() => events.emit('close'))
  })
  return {
    stdin,
    stdout,
    stderr: new PassThrough(),
    kill: () => true,
    once: (event: string, listener: (error: Error) => void) => events.once(event, listener),
    stdinEnded: () => ended
  }
}

function fakeRoutes(ready = true): SshVpnDatabaseRoutes & {
  setReady: (next: boolean) => void
  emit: (status: SshVpnStatus) => void
} {
  let isReady = ready
  const listeners = new Set<(status: SshVpnStatus) => void>()
  return {
    prepare: vi.fn(async () => ({ profileName: 'office' })),
    readyRoute: () => (isReady ? ROUTE : null),
    watch: (_profileId, listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setReady: (next) => {
      isReady = next
    },
    emit: (status) => {
      for (const listener of listeners) {
        listener(status)
      }
    }
  }
}

function deps(
  routes: SshVpnDatabaseRoutes,
  overrides: Partial<DatabaseVpnTunnelDeps> = {}
): DatabaseVpnTunnelDeps & { pipes: ReturnType<typeof echoPipe>[] } {
  const pipes: ReturnType<typeof echoPipe>[] = []
  return {
    pipes,
    routes: () => routes,
    spawnPipe: vi.fn(() => {
      const pipe = echoPipe()
      pipes.push(pipe)
      return pipe
    }),
    probe: vi.fn(async () => ({ ok: true, detail: '' })),
    ...overrides
  }
}

const REQUEST = {
  profileId: 'vpn-0001',
  connectionLabel: 'shop@db.vpn',
  remoteHost: 'db.vpn',
  remotePort: 5432
}

function roundTrip(port: number, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text))
    socket.once('data', (data) => {
      socket.end()
      resolve(String(data))
    })
    socket.once('error', reject)
  })
}

function refused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(true))
  })
}

describe('createDatabaseVpnTunnelOpener', () => {
  it('pipes each driver connection through nc in the VPN container', async () => {
    const routes = fakeRoutes()
    const tunnelDeps = deps(routes)
    const tunnel = await createDatabaseVpnTunnelOpener(tunnelDeps)(REQUEST, () => undefined)

    expect(routes.prepare).toHaveBeenCalledWith('vpn-0001', 'shop@db.vpn')
    expect(tunnelDeps.probe).toHaveBeenCalledWith(ROUTE, 'db.vpn', 5432)
    expect(await roundTrip(tunnel.localPort, 'ping')).toBe('ping')
    expect(tunnelDeps.spawnPipe).toHaveBeenCalledWith(ROUTE, 'db.vpn', 5432)

    await tunnel.close()
    expect(tunnelDeps.pipes.every((pipe) => pipe.stdinEnded())).toBe(true)
    expect(await refused(tunnel.localPort)).toBe(true)
  })

  it('ends open pipes by closing their input, so nc exits inside the container', async () => {
    const tunnelDeps = deps(fakeRoutes())
    const tunnel = await createDatabaseVpnTunnelOpener(tunnelDeps)(REQUEST, () => undefined)
    const socket = connect(tunnel.localPort, '127.0.0.1')
    await new Promise((resolve) => socket.once('connect', resolve))
    await vi.waitFor(() => expect(tunnelDeps.pipes).toHaveLength(1))

    await tunnel.close()
    expect(tunnelDeps.pipes[0]?.stdinEnded()).toBe(true)
  })

  it('refuses a host name nc would read as an option, before starting the VPN', async () => {
    const routes = fakeRoutes()
    await expect(
      createDatabaseVpnTunnelOpener(deps(routes))(
        { ...REQUEST, remoteHost: '-e/bin/sh' },
        () => undefined
      )
    ).rejects.toThrow('cannot pass through the VPN safely')
    expect(routes.prepare).not.toHaveBeenCalled()
  })

  it('fails closed when the VPN is not up after starting', async () => {
    await expect(
      createDatabaseVpnTunnelOpener(deps(fakeRoutes(false)))(REQUEST, () => undefined)
    ).rejects.toThrow('VPN "office" is not connected, so Orca will not connect to this server.')
  })

  it('says why the server is unreachable through the VPN', async () => {
    const tunnelDeps = deps(fakeRoutes(), {
      probe: async () => ({ ok: false, detail: 'nc: bad address db.vpn' })
    })
    await expect(
      createDatabaseVpnTunnelOpener(tunnelDeps)(REQUEST, () => undefined)
    ).rejects.toThrow('VPN "office" could not reach db.vpn:5432 (nc: bad address db.vpn).')
  })

  it('ends the session when the VPN stops', async () => {
    const routes = fakeRoutes()
    const onLost = vi.fn()
    const tunnel = await createDatabaseVpnTunnelOpener(deps(routes))(REQUEST, onLost)

    routes.setReady(false)
    routes.emit('stopped')
    expect(onLost).toHaveBeenCalledExactlyOnceWith(
      'VPN "office" disconnected, so this connection ended.'
    )
    await vi.waitFor(async () => expect(await refused(tunnel.localPort)).toBe(true))
  })

  it('never dials outside the VPN when a connection arrives after it went down', async () => {
    const routes = fakeRoutes()
    const onLost = vi.fn()
    const tunnelDeps = deps(routes)
    const tunnel = await createDatabaseVpnTunnelOpener(tunnelDeps)(REQUEST, onLost)

    routes.setReady(false)
    const socket = connect(tunnel.localPort, '127.0.0.1')
    await new Promise((resolve) => socket.once('close', resolve))
    expect(tunnelDeps.spawnPipe).not.toHaveBeenCalled()
    expect(onLost).toHaveBeenCalledExactlyOnceWith(
      'VPN "office" is not connected, so Orca will not connect to this server.'
    )
  })
})
