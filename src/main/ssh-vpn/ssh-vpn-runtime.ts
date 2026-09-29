import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type {
  SshVpnCredentialRequest,
  SshVpnCredentials,
  SshVpnProfileState,
  SshVpnStartConfirmRequest
} from '../../shared/ssh-vpn-types'
import { runProcessSync } from '../../shared/child-process/run-process'
import type { SecretStore } from '../../shared/secret-store'
import { readOvpnProfileFile } from './ovpn-profile-files'
import {
  dockerRemoveArgs,
  resolveDockerPath,
  SshVpnDocker,
  SshVpnDockerError
} from './ssh-vpn-docker'
import { SshVpnLogins } from './ssh-vpn-logins'
import { SshVpnManager } from './ssh-vpn-manager'
import type { SshVpnDockerPort } from './ssh-vpn-manager-types'
import { SshVpnPasswordVault } from './ssh-vpn-password-vault'
import { SshVpnRendererRequests } from './ssh-vpn-renderer-requests'
import { setSshVpnRouteProvider } from './ssh-vpn-route'
import { SshVpnService } from './ssh-vpn-service'
import { SshVpnStore } from './ssh-vpn-store'

const QUIT_REMOVE_TIMEOUT_MS = 5_000

export type SshVpnRuntime = {
  store: SshVpnStore
  manager: SshVpnManager
  service: SshVpnService
  vault: SshVpnPasswordVault
  approvals: SshVpnRendererRequests<SshVpnStartConfirmRequest, boolean>
  logins: SshVpnRendererRequests<SshVpnCredentialRequest, SshVpnCredentials | null>
  /** Removes every container synchronously; for app quit. */
  removeAllSync: () => void
}

type SshVpnRuntimeOptions = {
  userDataPath: string
  secretStore: () => SecretStore
  onStateChange: (state: SshVpnProfileState) => void
  /** Profiles or assignments changed outside an IPC call (e.g. a username typed in a prompt). */
  onProfilesChanged: () => void
  /** Deliver a request to a window; false when there is none to ask. */
  sendStartConfirm: (request: SshVpnStartConfirmRequest) => boolean
  sendCredentialRequest: (request: SshVpnCredentialRequest) => boolean
}

/** Resolves docker once it is found; a miss is retried so installing Docker later just works. */
function createDockerResolver(): () => Promise<SshVpnDockerPort> {
  let docker: SshVpnDocker | null = null
  return async () => {
    if (docker) {
      return docker
    }
    const dockerPath = await resolveDockerPath()
    if (!dockerPath) {
      throw new SshVpnDockerError(
        'Docker was not found. Install Docker Desktop, OrbStack or Colima to use a VPN for SSH hosts'
      )
    }
    docker = new SshVpnDocker(dockerPath)
    return docker
  }
}

export function createSshVpnRuntime(options: SshVpnRuntimeOptions): SshVpnRuntime {
  const store = new SshVpnStore(join(options.userDataPath, 'ssh-vpn.json'))
  const vault = new SshVpnPasswordVault(
    join(options.userDataPath, 'ssh-vpn-passwords.json'),
    options.secretStore
  )
  const manager = new SshVpnManager({
    docker: createDockerResolver(),
    // Why: scopes containers to this profile directory, so a dev build never removes the app's.
    instanceTag: createHash('sha256').update(options.userDataPath).digest('hex').slice(0, 8),
    readFile: readOvpnProfileFile,
    onStateChange: options.onStateChange
  })
  const approvals = new SshVpnRendererRequests<SshVpnStartConfirmRequest, boolean>(
    options.sendStartConfirm,
    false
  )
  const logins = new SshVpnRendererRequests<SshVpnCredentialRequest, SshVpnCredentials | null>(
    options.sendCredentialRequest,
    null
  )
  const service = new SshVpnService({
    store,
    manager,
    approveStart: ({ profile, hostLabel, commands }) =>
      approvals.ask((requestId) => ({ requestId, profileName: profile.name, hostLabel, commands })),
    logins: new SshVpnLogins({
      vault,
      store,
      onProfileChanged: options.onProfilesChanged,
      prompt: ({ profile, hostLabel, error }) =>
        logins.ask((requestId) => ({
          requestId,
          profileName: profile.name,
          username: profile.username ?? '',
          hostLabel,
          error
        }))
    })
  })
  setSshVpnRouteProvider(service)

  try {
    // Why only with profiles: users who never set up a VPN should not have Orca poke Docker.
    if (store.listProfiles().length > 0) {
      void manager.removeStaleContainers().catch(() => undefined)
    }
  } catch (error) {
    // Why not rethrow: this runs during core handler registration; a bad ssh-vpn.json must not
    // take the rest of the app down. Connections still refuse to run until it is fixed.
    console.error('[ssh-vpn] could not read VPN settings:', error)
  }

  return {
    store,
    manager,
    service,
    vault,
    approvals,
    logins,
    removeAllSync: () => {
      const running = manager.runningContainers()
      if (running.length === 0) {
        return
      }
      // Why sync: an async `docker rm` can be cut off by process exit, leaving the tunnel up.
      runProcessSync({
        program: running[0].dockerPath,
        args: dockerRemoveArgs(...running.map((route) => route.containerName)),
        timeoutMs: QUIT_REMOVE_TIMEOUT_MS
      })
    }
  }
}
