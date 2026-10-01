import type { SshVpnCredentials, SshVpnProfileState } from '../../shared/ssh-vpn-types'
import type { SshVpnDocker } from './ssh-vpn-docker'

/** The parts of the `docker exec … openvpn` child the manager uses. */
export type OpenVpnProcess = {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stdin: { end(): unknown }
  kill(): boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: () => void): unknown
}

export type SshVpnDockerPort = Pick<
  SshVpnDocker,
  | 'dockerPath'
  | 'assertRunning'
  | 'hasImage'
  | 'buildImage'
  | 'startContainer'
  | 'applyFirewall'
  | 'writeFile'
  | 'countTunnels'
  | 'remove'
  | 'listContainers'
  | 'query'
> & { spawnOpenVpn(containerName: string, withLogin: boolean): OpenVpnProcess }

export type SshVpnManagerDeps = {
  /** Resolves the docker CLI; rejects with a user-facing message when it is missing. */
  docker: () => Promise<SshVpnDockerPort>
  /** Scopes containers to this Orca profile so a dev build never removes the installed app's. */
  instanceTag: string
  readFile: (filePath: string) => Promise<Buffer>
  onStateChange?: (state: SshVpnProfileState) => void
  now?: () => number
  readyTimeoutMs?: number
  pollIntervalMs?: number
}

/** How a connection reaches a ready VPN: pipe through `nc` in this container. */
export type SshVpnRoute = { dockerPath: string; containerName: string }

/** Shows the user every command a start will run; false means do not start. */
export type SshVpnStartConfirm = (commands: string[]) => Promise<boolean>

export class SshVpnStartDeclinedError extends Error {
  override name = 'SshVpnStartDeclinedError'
}

/**
 * The host was switched to another VPN instead of starting this one; the caller routes again.
 * A decline to the manager, so the VPN that was asked about stays stopped without an error.
 */
export class SshVpnProfileSwitchedError extends SshVpnStartDeclinedError {
  override name = 'SshVpnProfileSwitchedError'

  constructor(
    /** What the user saw and approved for the new VPN; null when nothing was approved yet. */
    readonly approvedCommands: readonly string[] | null
  ) {
    super('The host switched to another VPN')
  }
}

export type SshVpnStartOptions = {
  confirm?: SshVpnStartConfirm
  /** For profiles that ask for a login; null means the user cancelled. */
  credentials?: () => Promise<SshVpnCredentials | null>
  /** The server rejected the login, so a saved password must not be offered again. */
  onLoginRejected?: () => void
}
