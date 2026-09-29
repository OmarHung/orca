import { createServer, type Server, type Socket } from 'node:net'
import type { Readable, Writable } from 'node:stream'
import { runProcess, spawnProcess } from '../../shared/child-process/run-process'
import {
  isShellSafeSshHost,
  sshVpnReachabilityArgs,
  sshVpnTunnelArgs
} from '../../shared/ssh-vpn-command-format'
import {
  getSshVpnDatabaseRoutes,
  type SshVpnDatabaseRoutes
} from '../ssh-vpn/ssh-vpn-database-route'
import type { SshVpnRoute } from '../ssh-vpn/ssh-vpn-manager-types'
import type { OpenDatabaseVpnTunnel } from './database-session-manager'

// `nc -w 30` gives up on final reads 30s after its stdin closes; past that the pipe is stuck.
const PIPE_EXIT_GRACE_MS = 35_000
const PROBE_TIMEOUT_MS = 40_000

/** One `docker exec … nc host port`: its stdin/stdout carry one TCP connection. */
export type VpnPipeProcess = {
  stdin: Writable
  stdout: Readable
  stderr: Readable
  kill(): boolean
  once(event: 'close', listener: () => void): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
}

export type DatabaseVpnTunnelDeps = {
  routes: () => SshVpnDatabaseRoutes | null
  spawnPipe: (route: SshVpnRoute, host: string, port: number) => VpnPipeProcess
  /** `nc -z` through the VPN; `detail` is its last stderr line. */
  probe: (
    route: SshVpnRoute,
    host: string,
    port: number
  ) => Promise<{ ok: boolean; detail: string }>
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.trim() ?? ''
}

/** The real pipes: `docker exec` into the VPN's container. */
export const DOCKER_VPN_PIPES: Omit<DatabaseVpnTunnelDeps, 'routes'> = {
  spawnPipe: (route, host, port) =>
    spawnProcess({
      program: route.dockerPath,
      args: sshVpnTunnelArgs(route.containerName, host, String(port))
    }),
  probe: async (route, host, port) => {
    const result = await runProcess({
      program: route.dockerPath,
      args: sshVpnReachabilityArgs(route.containerName, host, String(port)),
      timeoutMs: PROBE_TIMEOUT_MS
    })
    return { ok: result.code === 0, detail: lastLine(result.stderr) }
  }
}

const DEFAULT_DEPS: DatabaseVpnTunnelDeps = { routes: getSshVpnDatabaseRoutes, ...DOCKER_VPN_PIPES }

/** Joins a driver's socket to one pipe; the returned function ends both. */
function joinPipe(socket: Socket, child: VpnPipeProcess, onExit: () => void): () => void {
  let killTimer: NodeJS.Timeout | null = null
  let exited = false
  // Why end stdin instead of killing: killing `docker exec` leaves `nc` running in the
  // container, where the VPN's idle check would count it as a live connection.
  const end = (): void => {
    socket.destroy()
    child.stdin.end()
    if (!exited && !killTimer) {
      killTimer = setTimeout(() => child.kill(), PIPE_EXIT_GRACE_MS)
      killTimer.unref()
    }
  }
  socket.pipe(child.stdin)
  child.stdout.pipe(socket)
  // Why drain: a full stderr pipe blocks the process, which looks like a hung connection.
  child.stderr.on('data', (chunk: Buffer | string) => {
    const text = String(chunk).trim()
    if (text) {
      console.warn(`[database] VPN tunnel: ${text}`)
    }
  })
  socket.on('error', end)
  socket.once('close', end)
  child.stdin.on('error', end)
  child.once('error', end)
  child.once('close', () => {
    exited = true
    if (killTimer) {
      clearTimeout(killTimer)
    }
    onExit()
  })
  return end
}

function listenOnLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (typeof address === 'object' && address) {
        resolve(address.port)
      } else {
        reject(new Error('the local tunnel port could not be opened.'))
      }
    })
  })
}

/**
 * Tunnels for database connections that name a VPN profile: a loopback port whose every
 * connection is piped through `nc` in the VPN's container, like the SSH page's ProxyCommand.
 * Fails closed: nothing is dialed outside the VPN, and the session ends when the VPN does.
 */
export function createDatabaseVpnTunnelOpener(
  deps: DatabaseVpnTunnelDeps = DEFAULT_DEPS
): OpenDatabaseVpnTunnel {
  return async ({ profileId, connectionLabel, remoteHost, remotePort }, onLost) => {
    const routes = deps.routes()
    if (!routes) {
      throw new Error('VPNs are not available here.')
    }
    // Why: `nc` takes the host as an argument, so a leading "-" would become an option.
    if (!isShellSafeSshHost(remoteHost)) {
      throw new Error(
        `the host name "${remoteHost}" has characters Orca cannot pass through the VPN safely.`
      )
    }
    const { profileName } = await routes.prepare(profileId, connectionLabel)
    const notConnected = `VPN "${profileName}" is not connected, so Orca will not connect to this server.`
    const route = routes.readyRoute(profileId)
    if (!route) {
      throw new Error(notConnected)
    }
    // Why probe: a pipe to an unreachable host just closes, which drivers report without a reason.
    const probe = await deps.probe(route, remoteHost, remotePort)
    if (!probe.ok) {
      const detail = probe.detail ? ` (${probe.detail})` : ''
      throw new Error(`VPN "${profileName}" could not reach ${remoteHost}:${remotePort}${detail}.`)
    }

    const pipes = new Set<() => void>()
    let open = true
    let lose: (message: string) => void = () => undefined
    const server = createServer((socket) => {
      const current = routes.readyRoute(profileId)
      if (!open || !current) {
        socket.destroy()
        lose(notConnected)
        return
      }
      const end = joinPipe(socket, deps.spawnPipe(current, remoteHost, remotePort), () =>
        pipes.delete(end)
      )
      pipes.add(end)
    })
    const localPort = await listenOnLoopback(server)
    const unwatch = routes.watch(profileId, (status) => {
      if (status !== 'ready') {
        lose(`VPN "${profileName}" disconnected, so this connection ended.`)
      }
    })
    const close = async (): Promise<void> => {
      if (!open) {
        return
      }
      open = false
      unwatch()
      for (const end of pipes) {
        end()
      }
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    lose = (message) => {
      if (open) {
        void close()
        onLost(message)
      }
    }
    // Why re-check: the VPN may have stopped between the probe and the watch.
    if (!routes.readyRoute(profileId)) {
      await close()
      throw new Error(notConnected)
    }
    return { localPort, close }
  }
}
