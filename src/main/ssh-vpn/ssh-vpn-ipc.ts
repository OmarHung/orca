import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { SshVpnProfileState } from '../../shared/ssh-vpn-types'
import { runProcessSync } from '../../shared/child-process/run-process'
import {
  resolveDockerPath,
  SshVpnDocker,
  SshVpnDockerError,
  dockerRemoveArgs
} from './ssh-vpn-docker'
import { SshVpnManager, type SshVpnDockerPort } from './ssh-vpn-manager'
import { setSshVpnRouteProvider } from './ssh-vpn-route'
import { SshVpnService } from './ssh-vpn-service'
import { SshVpnStore } from './ssh-vpn-store'

const QUIT_REMOVE_TIMEOUT_MS = 5_000

function broadcastState(state: SshVpnProfileState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('sshVpn:state', state)
    }
  }
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

export function registerSshVpnHandlers(): void {
  const userData = app.getPath('userData')
  const store = new SshVpnStore(join(userData, 'ssh-vpn.json'))
  const docker = createDockerResolver()
  const manager = new SshVpnManager({
    docker,
    instanceTag: createHash('sha256').update(userData).digest('hex').slice(0, 8),
    readFile: (filePath) => readFile(filePath),
    onStateChange: broadcastState
  })
  setSshVpnRouteProvider(new SshVpnService(store, manager))

  // Why only with profiles: users who never set up a VPN should not have Orca poke Docker.
  if (store.listProfiles().length > 0) {
    void manager.removeStaleContainers().catch(() => undefined)
  }

  app.on('will-quit', () => {
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
  })
}
