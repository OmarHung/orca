import type { SshTarget } from '../../shared/ssh-types'
import type { SshVpnProfile, SshVpnTerminalRoute } from '../../shared/ssh-vpn-types'
import {
  isShellSafeSshHost,
  sshVpnProxyCommand,
  sshVpnTunnelArgs
} from '../../shared/ssh-vpn-command-format'
import type { SshResolvedConfig } from '../ssh/ssh-config-parser'
import { resolveEffectiveProxy, type EffectiveProxy } from '../ssh/ssh-proxy-command'
import type { SshVpnLogins } from './ssh-vpn-logins'
import type { SshVpnManager } from './ssh-vpn-manager'
import type { SshVpnRoute, SshVpnStartOptions } from './ssh-vpn-manager-types'
import type { SshVpnRouteProvider } from './ssh-vpn-route'
import type { SshVpnStore } from './ssh-vpn-store'

/** Asks the user to approve a VPN start; `hostLabel` names the connection that needs it. */
export type SshVpnStartApproval = (request: {
  profile: SshVpnProfile
  hostLabel: string | null
  commands: string[]
}) => Promise<boolean>

type SshVpnServiceDeps = {
  store: Pick<SshVpnStore, 'profileForTarget' | 'getProfile'>
  manager: Pick<SshVpnManager, 'acquire' | 'getReadyRoute'>
  approveStart?: SshVpnStartApproval
  logins?: Pick<SshVpnLogins, 'startOptions'>
  platform?: NodeJS.Platform
}

function assertNoCompetingProxy(
  target: SshTarget,
  resolved: SshResolvedConfig | null,
  profile: SshVpnProfile
): void {
  // Why refuse: OpenSSH keeps whichever of ProxyCommand/ProxyJump comes first, so combining them
  // with the VPN would silently change which route the connection takes.
  if (resolveEffectiveProxy(target, resolved) || resolved?.proxyUseFdpass) {
    throw new Error(
      `VPN "${profile.name}": this host already connects through ProxyJump or ProxyCommand (check ~/.ssh/config, including Host * blocks). Using both is not supported yet.`
    )
  }
}

/** OpenSSH puts %h into the ProxyCommand it runs through a shell, so the name must be inert. */
function assertSafeHost(
  target: SshTarget,
  resolved: SshResolvedConfig | null,
  profile: SshVpnProfile
): void {
  const host = resolved?.hostname || target.host
  if (!isShellSafeSshHost(host)) {
    throw new Error(
      `VPN "${profile.name}": the host name "${host}" has characters Orca cannot pass through the VPN safely`
    )
  }
}

/** Routes hosts assigned to a VPN profile through that profile's container. */
export class SshVpnService implements SshVpnRouteProvider {
  constructor(private readonly deps: SshVpnServiceDeps) {}

  async prepare(
    target: SshTarget,
    resolved: SshResolvedConfig | null
  ): Promise<EffectiveProxy | null> {
    const route = await this.routeFor(target, resolved)
    return route
      ? {
          kind: 'argv',
          program: route.dockerPath,
          args: sshVpnTunnelArgs(route.containerName, '%h', '%p')
        }
      : null
  }

  /** For the SSH page, which types `ssh` into a terminal instead of connecting itself. */
  async prepareTerminal(
    target: SshTarget,
    resolved: SshResolvedConfig | null
  ): Promise<SshVpnTerminalRoute | null> {
    const profile = this.deps.store.profileForTarget(target.id)
    const route = await this.routeFor(target, resolved)
    return route && profile ? { profileName: profile.name, ...route } : null
  }

  /** A start the user asked for directly, e.g. the Connect button. */
  async connect(profileId: string): Promise<void> {
    const profile = this.deps.store.getProfile(profileId)
    if (!profile) {
      throw new Error('This VPN profile no longer exists')
    }
    await this.deps.manager.acquire(profile, this.startOptions(profile, null))
  }

  proxyCommand(target: SshTarget): string | null {
    const profile = this.deps.store.profileForTarget(target.id)
    if (!profile) {
      return null
    }
    const route = this.deps.manager.getReadyRoute(profile.id)
    if (!route) {
      // Why throw: returning null would let system ssh dial the host directly, outside the VPN.
      throw new Error(
        `VPN "${profile.name}" is not connected, so Orca will not connect to this host`
      )
    }
    return sshVpnProxyCommand(
      route.dockerPath,
      route.containerName,
      this.deps.platform ?? process.platform
    )
  }

  routeKey(target: SshTarget): string {
    try {
      return this.deps.store.profileForTarget(target.id)?.id ?? ''
    } catch {
      // Why: an unreadable assignment must not match any master opened for a direct route.
      return 'unreadable'
    }
  }

  private async routeFor(
    target: SshTarget,
    resolved: SshResolvedConfig | null
  ): Promise<SshVpnRoute | null> {
    const profile = this.deps.store.profileForTarget(target.id)
    if (!profile) {
      return null
    }
    assertNoCompetingProxy(target, resolved, profile)
    assertSafeHost(target, resolved, profile)
    return this.deps.manager.acquire(profile, this.startOptions(profile, target.label))
  }

  private startOptions(profile: SshVpnProfile, hostLabel: string | null): SshVpnStartOptions {
    const approve = this.deps.approveStart
    return {
      confirm: approve ? (commands) => approve({ profile, hostLabel, commands }) : undefined,
      ...this.deps.logins?.startOptions(profile, hostLabel)
    }
  }
}
