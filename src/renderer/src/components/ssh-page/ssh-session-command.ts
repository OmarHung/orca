import type { SshTarget } from '../../../../shared/ssh-types'

const DEFAULT_SSH_PORT = 22
const MAX_PORT = 65_535
// Why: the command is typed into the user's shell (bash, zsh, PowerShell, cmd), so only allow
// characters none of them expand, and no leading "-" that ssh would read as an option.
const SAFE_HOST = /^[A-Za-z0-9._:%][A-Za-z0-9._:%-]*$/
const SAFE_USER = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/

type SshSessionEndpoint = Pick<SshTarget, 'configHost' | 'host' | 'port' | 'username'>

/** The `ssh` command that opens an interactive session, or null when it can't be typed safely. */
export function buildSshSessionCommand(target: SshSessionEndpoint): string | null {
  if (target.configHost) {
    return SAFE_HOST.test(target.configHost) ? `ssh ${target.configHost}` : null
  }
  if (!SAFE_HOST.test(target.host) || (target.username && !SAFE_USER.test(target.username))) {
    return null
  }
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > MAX_PORT) {
    return null
  }
  const port = target.port === DEFAULT_SSH_PORT ? '' : ` -p ${target.port}`
  const user = target.username ? `${target.username}@` : ''
  return `ssh${port} ${user}${target.host}`
}
