// Shared by main (runs and previews the commands) and the renderer (types them into a terminal).

const POSIX_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/
// Why: host names reach shells (a typed command, OpenSSH's `$SHELL -c` ProxyCommand), so only
// characters no shell expands, and no leading "-" that ssh would read as an option.
const SAFE_SSH_HOST = /^[A-Za-z0-9._:%][A-Za-z0-9._:%-]*$/

export function isShellSafeSshHost(host: string): boolean {
  return SAFE_SSH_HOST.test(host)
}

/** The container user every per-connection `nc` runs as; its firewall only allows the VPN. */
export const SSH_VPN_TUNNEL_USER = 'tunnel'

// Matches ssh2's CONNECT_TIMEOUT_MS so the tunnel never outlives the attempt it serves.
const TUNNEL_CONNECT_TIMEOUT_SECONDS = '30'

export function quotePosixArg(value: string): string {
  return POSIX_SAFE.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`
}

/** argv as a POSIX shell line: what the confirm dialogs show and what the terminal types. */
export function formatPosixCommand(argv: readonly string[]): string {
  return argv.map(quotePosixArg).join(' ')
}

/** The per-connection pipe: `nc` inside the container, so the TCP connection leaves through tun0. */
export function sshVpnTunnelArgs(containerName: string, host: string, port: string): string[] {
  // Why -w: killing the `docker exec` client does not kill `nc`, so a connect to a filtered port
  // would hang in the container and count as a live connection forever. -w bounds only the connect.
  return [
    'exec',
    '-i',
    '--user',
    SSH_VPN_TUNNEL_USER,
    containerName,
    'nc',
    '-w',
    TUNNEL_CONNECT_TIMEOUT_SECONDS,
    host,
    port
  ]
}

/** Checks that the VPN reaches host:port (`nc -z`: connect, send nothing, exit 0 on success). */
export function sshVpnReachabilityArgs(
  containerName: string,
  host: string,
  port: string
): string[] {
  return [
    'exec',
    '--user',
    SSH_VPN_TUNNEL_USER,
    containerName,
    'nc',
    '-z',
    '-w',
    TUNNEL_CONNECT_TIMEOUT_SECONDS,
    host,
    port
  ]
}

/**
 * The ProxyCommand OpenSSH runs for a host routed through the VPN. OpenSSH hands it to
 * `$SHELL -c` on POSIX and to CreateProcess on Windows, so the docker path is quoted for that.
 */
export function sshVpnProxyCommand(
  dockerPath: string,
  containerName: string,
  platform: NodeJS.Platform
): string {
  const program =
    platform === 'win32'
      ? /[\s"]/.test(dockerPath)
        ? `"${dockerPath}"`
        : dockerPath
      : quotePosixArg(dockerPath)
  return `${program} ${sshVpnTunnelArgs(containerName, '%h', '%p').join(' ')}`
}

/**
 * `-o ProxyCommand=…` as typed into the user's login shell by the SSH page. On Windows the
 * shell may be cmd.exe or PowerShell, which share only double quotes, so it names `docker` from
 * PATH (Docker Desktop adds it) instead of nesting a quoted path.
 */
export function sshVpnTerminalProxyOption(
  route: { dockerPath: string; containerName: string },
  platform: NodeJS.Platform
): string {
  if (platform === 'win32') {
    return `-o "ProxyCommand=docker ${sshVpnTunnelArgs(route.containerName, '%h', '%p').join(' ')}"`
  }
  return `-o ${quotePosixArg(`ProxyCommand=${sshVpnProxyCommand(route.dockerPath, route.containerName, platform)}`)}`
}
