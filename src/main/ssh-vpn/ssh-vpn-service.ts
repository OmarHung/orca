import type { SshTarget } from '../../shared/ssh-types'
import type { SshVpnProfile } from '../../shared/ssh-vpn-types'
import type { SshResolvedConfig } from '../ssh/ssh-config-parser'
import { resolveEffectiveProxy, type EffectiveProxy } from '../ssh/ssh-proxy-command'
import { dockerTunnelArgs, sshVpnProxyCommand } from './ssh-vpn-docker'
import type { SshVpnManager } from './ssh-vpn-manager'
import type { SshVpnRouteProvider } from './ssh-vpn-route'
import type { SshVpnStore } from './ssh-vpn-store'

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

/** Routes hosts assigned to a VPN profile through that profile's container. */
export class SshVpnService implements SshVpnRouteProvider {
  constructor(
    private readonly store: Pick<SshVpnStore, 'profileForTarget'>,
    private readonly manager: Pick<SshVpnManager, 'acquire' | 'getReadyRoute'>
  ) {}

  async prepare(
    target: SshTarget,
    resolved: SshResolvedConfig | null
  ): Promise<EffectiveProxy | null> {
    const profile = this.store.profileForTarget(target.id)
    if (!profile) {
      return null
    }
    assertNoCompetingProxy(target, resolved, profile)
    const route = await this.manager.acquire(profile)
    return {
      kind: 'argv',
      program: route.dockerPath,
      args: dockerTunnelArgs(route.containerName, '%h', '%p')
    }
  }

  proxyCommand(target: SshTarget): string | null {
    const profile = this.store.profileForTarget(target.id)
    if (!profile) {
      return null
    }
    const route = this.manager.getReadyRoute(profile.id)
    if (!route) {
      // Why throw: returning null would let system ssh dial the host directly, outside the VPN.
      throw new Error(
        `VPN "${profile.name}" is not connected, so Orca will not connect to this host`
      )
    }
    return sshVpnProxyCommand(route.dockerPath, route.containerName)
  }
}
