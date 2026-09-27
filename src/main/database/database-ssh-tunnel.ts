import { createServer } from 'node:net'
import type { SshConnection } from '../ssh/ssh-connection'
import { SshPortForwardManager } from '../ssh/ssh-port-forward'
import {
  getSshProviderAuthority,
  registerSshProviderRequestAbort
} from '../ssh/ssh-provider-authority'
import { getSshTargetRegistryStore } from '../ssh/ssh-target-registry'
import { DatabaseSshConnections } from './database-ssh-connections'
import type { DatabaseTunnel, OpenDatabaseTunnel } from './database-session-manager'

const LISTEN_ATTEMPTS = 3

export type DatabaseTunnelDeps = {
  targetLabel: (targetId: string) => string | null
  /** An SSH link to a saved host (prompting for credentials if needed), handed back on close. */
  acquireConnection: (
    targetId: string
  ) => Promise<{ connection: SshConnection; release: () => void }>
  /** Aborts `controller` when the SSH connection is reset or disconnected. */
  watchConnection: (targetId: string, controller: AbortController) => () => void
  freeLoopbackPort: () => Promise<number>
  createForwards: (
    callbacks: ConstructorParameters<typeof SshPortForwardManager>[0]
  ) => SshPortForwardManager
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port'))
      )
    })
  })
}

const links = new DatabaseSshConnections()

const DEFAULT_DEPS: DatabaseTunnelDeps = {
  targetLabel: (targetId) => getSshTargetRegistryStore()?.getTarget(targetId)?.label ?? null,
  acquireConnection: (targetId) => links.acquire(targetId),
  // Why both: the link can drop on its own, and disconnecting the host in Orca should end it too.
  watchConnection: (targetId, controller) => {
    const unwatchHost = registerSshProviderRequestAbort(
      getSshProviderAuthority(targetId),
      controller
    )
    const unwatchLink = links.watch(targetId, controller)
    return () => {
      unwatchHost()
      unwatchLink()
    }
  },
  freeLoopbackPort,
  createForwards: (callbacks) => new SshPortForwardManager(callbacks)
}

// Why probe: an ssh2 forward drops a refused channel silently, which the driver would only
// report as a closed socket. Asking once gives the SSH host's own reason.
function probeRemote(connection: SshConnection, host: string, port: number): Promise<void> {
  const client = connection.getClient()
  if (!client) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (error, channel) => {
      if (error) {
        reject(new Error(`the SSH host could not reach ${host}:${port} (${error.message})`))
        return
      }
      channel.close()
      resolve()
    })
  })
}

/**
 * Tunnels for database sessions, on their own forward manager: unlike the Ports panel's
 * forwards they are not saved on the SSH host, not listed there, and not restored after a
 * reconnect — the database session reconnects instead.
 */
export function createDatabaseTunnelOpener(
  deps: DatabaseTunnelDeps = DEFAULT_DEPS
): OpenDatabaseTunnel {
  const stopped = new Map<string, (detail: string) => void>()
  const forwards = deps.createForwards({
    onForwardClosed: (entry, reason) => {
      if (reason.kind === 'unexpected-exit') {
        stopped.get(entry.id)?.(reason.detail ?? 'the forward stopped')
      }
    }
  })

  const addForward = async (key: string, connection: SshConnection, host: string, port: number) => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const localPort = await deps.freeLoopbackPort()
        return await forwards.addForward(`database:${key}`, connection, localPort, host, port)
      } catch (error) {
        // Why retry: another process can take the free port between probing and listening.
        if (attempt >= LISTEN_ATTEMPTS) {
          throw error
        }
      }
    }
  }

  return async ({ key, targetId, remoteHost, remotePort }, onLost): Promise<DatabaseTunnel> => {
    const label = deps.targetLabel(targetId)
    if (label === null) {
      throw new Error('its SSH host was removed from Orca.')
    }
    const { connection, release } = await deps.acquireConnection(targetId)
    let entry: Awaited<ReturnType<typeof addForward>>
    try {
      await probeRemote(connection, remoteHost, remotePort)
      entry = await addForward(key, connection, remoteHost, remotePort)
    } catch (error) {
      release()
      throw error
    }

    const reset = new AbortController()
    const unwatch = deps.watchConnection(targetId, reset)
    let open = true
    const close = async (): Promise<void> => {
      if (!open) {
        return
      }
      open = false
      stopped.delete(entry.id)
      unwatch()
      await forwards.removeForwardAndWait(entry.id)
      release()
    }
    // Why "no longer available": a dropped SSH link says nothing about the server itself.
    const lose = (message: string): void => {
      if (open) {
        void close()
        onLost(message)
      }
    }
    stopped.set(entry.id, (detail) => lose(`the SSH tunnel through ${label} stopped (${detail}).`))
    reset.signal.addEventListener('abort', () =>
      lose(`the SSH connection to ${label} was reset, so its tunnel is no longer available.`)
    )
    return { localPort: entry.localPort, close }
  }
}
