import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type {
  SshVpnCredentialRequest,
  SshVpnCredentials,
  SshVpnProfileState,
  SshVpnStartAnswer,
  SshVpnStartConfirmRequest,
  SshVpnStartPreview,
  SshVpnStatus
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
import { setSshVpnDatabaseRoutes } from './ssh-vpn-database-route'
import { SshVpnRendererRequests } from './ssh-vpn-renderer-requests'
import { setSshVpnRouteProvider } from './ssh-vpn-route'
import { SshVpnService } from './ssh-vpn-service'
import { previewSshVpnStart } from './ssh-vpn-start-sequence'
import { SshVpnStore } from './ssh-vpn-store'

const QUIT_REMOVE_TIMEOUT_MS = 5_000

export type SshVpnRuntime = {
  /** Resolves the docker CLI; rejects with a user-facing message when it is missing. */
  docker: () => Promise<SshVpnDockerPort>
  store: SshVpnStore
  manager: SshVpnManager
  service: SshVpnService
  vault: SshVpnPasswordVault
  approvals: SshVpnRendererRequests<SshVpnStartConfirmRequest, SshVpnStartAnswer>
  logins: SshVpnRendererRequests<SshVpnCredentialRequest, SshVpnCredentials | null>
  /** What using a profile would take right now, for the start confirmation's VPN picker. */
  previewStart: (profileId: string) => Promise<SshVpnStartPreview>
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
  const stateWatchers = new Set<(state: SshVpnProfileState) => void>()
  const docker = createDockerResolver()
  // Why: scopes containers to this profile directory, so a dev build never removes the app's.
  const instanceTag = createHash('sha256').update(options.userDataPath).digest('hex').slice(0, 8)
  const manager = new SshVpnManager({
    docker,
    instanceTag,
    readFile: readOvpnProfileFile,
    onStateChange: (state) => {
      options.onStateChange(state)
      for (const watcher of stateWatchers) {
        watcher(state)
      }
    }
  })
  const approvals = new SshVpnRendererRequests<SshVpnStartConfirmRequest, SshVpnStartAnswer>(
    options.sendStartConfirm,
    { approved: false }
  )
  const logins = new SshVpnRendererRequests<SshVpnCredentialRequest, SshVpnCredentials | null>(
    options.sendCredentialRequest,
    null
  )
  const service = new SshVpnService({
    store,
    manager,
    approveStart: ({ profile, hostLabel, switchable, commands }) =>
      approvals.ask((requestId) => ({
        requestId,
        profileId: profile.id,
        profileName: profile.name,
        hostLabel,
        switchable,
        commands
      })),
    onAssignmentChanged: options.onProfilesChanged,
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
  setSshVpnDatabaseRoutes({
    prepare: async (profileId, connectionLabel) => ({
      profileName: await service.connect(profileId, connectionLabel)
    }),
    readyRoute: (profileId) => manager.getReadyRoute(profileId),
    watch: (profileId, listener: (status: SshVpnStatus) => void) => {
      const watcher = (state: SshVpnProfileState): void => {
        if (state.profileId === profileId) {
          listener(state.status)
        }
      }
      stateWatchers.add(watcher)
      return () => {
        stateWatchers.delete(watcher)
      }
    }
  })

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
    docker,
    store,
    manager,
    service,
    vault,
    approvals,
    logins,
    previewStart: async (profileId) => {
      const profile = store.getProfile(profileId)
      if (!profile) {
        throw new Error('This VPN profile no longer exists')
      }
      const isReady = (id: string): boolean => manager.getReadyRoute(id) !== null
      return previewSshVpnStart(
        { docker, instanceTag, readFile: readOvpnProfileFile, isReady },
        profile
      )
    },
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
