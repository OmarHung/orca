import type { SshConnectionState, SshTarget } from '../../shared/ssh-types'
import { getCurrentMainWindow } from '../ipc/ssh-ipc-context'
import { requestCredential } from '../ipc/ssh-passphrase'
import { SshConnection } from '../ssh/ssh-connection'
import type { SshConnectionCallbacks } from '../ssh/ssh-connection-utils'
import { getSshTargetRegistryStore } from '../ssh/ssh-target-registry'

type DatabaseSshLinkConnection = Pick<
  SshConnection,
  'connect' | 'disconnect' | 'getState' | 'getClient'
>

export type DatabaseSshConnectionsDeps = {
  findTarget: (targetId: string) => SshTarget | undefined
  createConnection: (target: SshTarget, callbacks: SshConnectionCallbacks) => SshConnection
}

type Link = { connection: SshConnection; users: number; watchers: Set<AbortController> }

const DEFAULT_DEPS: DatabaseSshConnectionsDeps = {
  findTarget: (targetId) => getSshTargetRegistryStore()?.getTarget(targetId),
  createConnection: (target, callbacks) => new SshConnection(target, callbacks)
}

/**
 * SSH links for database tunnels alone. A port forward needs only the SSH connection, not
 * Orca's relay (which requires Node.js on the host), and keeping them out of the shared
 * connection manager means SSH workspaces and settings never see or reuse them. One link
 * per SSH host is shared by its tunnels and closed with the last of them.
 */
export class DatabaseSshConnections {
  private readonly links = new Map<string, Link>()
  private readonly connecting = new Map<string, Promise<Link>>()

  constructor(private readonly deps: DatabaseSshConnectionsDeps = DEFAULT_DEPS) {}

  async acquire(targetId: string): Promise<{ connection: SshConnection; release: () => void }> {
    const link = await this.link(targetId)
    link.users += 1
    let released = false
    return {
      connection: link.connection,
      release: () => {
        if (released) {
          return
        }
        released = true
        link.users -= 1
        if (link.users === 0 && this.links.get(targetId) === link) {
          this.drop(targetId)
        }
      }
    }
  }

  /** Aborts `controller` when the host's link drops; the returned function stops watching. */
  watch(targetId: string, controller: AbortController): () => void {
    const link = this.links.get(targetId)
    link?.watchers.add(controller)
    return () => {
      link?.watchers.delete(controller)
    }
  }

  private link(targetId: string): Promise<Link> {
    const existing = this.links.get(targetId)
    if (existing?.connection.getState().status === 'connected') {
      return Promise.resolve(existing)
    }
    const pending = this.connecting.get(targetId)
    if (pending) {
      return pending
    }
    const target = this.deps.findTarget(targetId)
    if (!target) {
      return Promise.reject(new Error('its SSH host was removed from Orca.'))
    }
    const connection = this.deps.createConnection(target, {
      onStateChange: (_id, state) => this.onStateChange(targetId, connection, state),
      onCredentialRequest: (id, kind, detail, signal) =>
        requestCredential(getCurrentMainWindow, id, kind, detail, signal)
    })
    const created = connection.connect().then(() => {
      const link: Link = { connection, users: 0, watchers: new Set() }
      this.links.set(targetId, link)
      return link
    })
    this.connecting.set(targetId, created)
    created.then(
      () => this.connecting.delete(targetId),
      () => {
        this.connecting.delete(targetId)
        // Why disconnect a failed attempt: it would otherwise keep retrying in the background.
        void connection.disconnect().catch(() => undefined)
      }
    )
    return created
  }

  private onStateChange(
    targetId: string,
    connection: DatabaseSshLinkConnection,
    state: SshConnectionState
  ): void {
    const link = this.links.get(targetId)
    // Why drop instead of letting it reconnect: the database session reconnects, and with it
    // a fresh link, so a background reconnect here would only hold an idle SSH session.
    if (link?.connection === connection && state.status !== 'connected') {
      this.drop(targetId)
    }
  }

  private drop(targetId: string): void {
    const link = this.links.get(targetId)
    if (!link) {
      return
    }
    this.links.delete(targetId)
    for (const watcher of link.watchers) {
      watcher.abort()
    }
    void link.connection.disconnect().catch(() => undefined)
  }
}
