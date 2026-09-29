import type { SshTarget } from '../../../../shared/ssh-types'
import { isShellSafeSshHost } from '../../../../shared/ssh-vpn-command-format'

const DEFAULT_SSH_PORT = 22
const MAX_PORT = 65_535
// Why: the command is typed into the user's shell (bash, zsh, PowerShell, cmd).
const SAFE_USER = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/

type SshSessionEndpoint = Pick<SshTarget, 'configHost' | 'host' | 'port' | 'username'>

/**
 * The `ssh` command that opens an interactive session, or null when it can't be typed safely.
 * `options` are already quoted for the shell (the VPN's `-o ProxyCommand=…`).
 */
export function buildSshSessionCommand(
  target: SshSessionEndpoint,
  options: readonly string[] = []
): string | null {
  const ssh = ['ssh', ...options].join(' ')
  if (target.configHost) {
    return isShellSafeSshHost(target.configHost) ? `${ssh} ${target.configHost}` : null
  }
  if (!isShellSafeSshHost(target.host) || (target.username && !SAFE_USER.test(target.username))) {
    return null
  }
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > MAX_PORT) {
    return null
  }
  const port = target.port === DEFAULT_SSH_PORT ? '' : ` -p ${target.port}`
  const user = target.username ? `${target.username}@` : ''
  return `${ssh}${port} ${user}${target.host}`
}
