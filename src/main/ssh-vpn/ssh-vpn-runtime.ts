import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SshVpnProfileState, SshVpnStartConfirmRequest } from '../../shared/ssh-vpn-types'
import { runProcessSync } from '../../shared/child-process/run-process'
import {
  dockerRemoveArgs,
  resolveDockerPath,
  SshVpnDocker,
  SshVpnDockerError
} from './ssh-vpn-docker'
import { SshVpnManager, type SshVpnDockerPort } from './ssh-vpn-manager'
import { setSshVpnRouteProvider } from './ssh-vpn-route'
import { SshVpnService } from './ssh-vpn-service'
import { SshVpnStartApprovals } from './ssh-vpn-start-approvals'
import { SshVpnStore } from './ssh-vpn-store'

const QUIT_REMOVE_TIMEOUT_MS = 5_000

export type SshVpnRuntime = {
  store: SshVpnStore
  manager: SshVpnManager
  service: SshVpnService
  approvals: SshVpnStartApprovals
  /** Removes every container synchronously; for app quit. */
  removeAllSync: () => void
}

type SshVpnRuntimeOptions = {
  userDataPath: string
  onStateChange: (state: SshVpnProfileState) => void
  /** Delivers a start confirmation to a window; false when there is none. */
  sendStartConfirm: (request: SshVpnStartConfirmRequest) => boolean
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
  const manager = new SshVpnManager({
    docker: createDockerResolver(),
    // Why: scopes containers to this profile directory, so a dev build never removes the app's.
    instanceTag: createHash('sha256').update(options.userDataPath).digest('hex').slice(0, 8),
    readFile: (filePath) => readFile(filePath),
    onStateChange: options.onStateChange
  })
  const approvals = new SshVpnStartApprovals(options.sendStartConfirm)
  const service = new SshVpnService({ store, manager, approveStart: approvals.approve })
  setSshVpnRouteProvider(service)

  // Why only with profiles: users who never set up a VPN should not have Orca poke Docker.
  if (store.listProfiles().length > 0) {
    void manager.removeStaleContainers().catch(() => undefined)
  }

  return {
    store,
    manager,
    service,
    approvals,
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
