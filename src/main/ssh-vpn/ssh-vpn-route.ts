import type { SshTarget } from '../../shared/ssh-types'
import type { SshResolvedConfig } from '../ssh/ssh-config-parser'
import type { EffectiveProxy } from '../ssh/ssh-proxy-command'

/**
 * The seam between upstream SSH code and the fork's per-host VPN. Kept free of runtime imports
 * so ssh-connection and system-ssh-args can depend on it without an import cycle.
 */
export type SshVpnRouteProvider = {
  /** Starts the host's VPN when it has one and returns the proxy to connect through; null if none. */
  prepare(target: SshTarget, resolved: SshResolvedConfig | null): Promise<EffectiveProxy | null>
  /** ProxyCommand for system ssh; throws when the host has a VPN that is not up. */
  proxyCommand(target: SshTarget): string | null
}

let provider: SshVpnRouteProvider | null = null

export function setSshVpnRouteProvider(next: SshVpnRouteProvider | null): void {
  provider = next
}

export function prepareSshVpnRoute(
  target: SshTarget,
  resolved: SshResolvedConfig | null
): Promise<EffectiveProxy | null> {
  return provider ? provider.prepare(target, resolved) : Promise.resolve(null)
}

export function getSshVpnProxyCommand(target: SshTarget): string | null {
  return provider?.proxyCommand(target) ?? null
}
