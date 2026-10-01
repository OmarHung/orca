import type { SshTarget } from '../../shared/ssh-types'
import type {
  SshVpnProfile,
  SshVpnStartAnswer,
  SshVpnTerminalRoute
} from '../../shared/ssh-vpn-types'
import {
  isShellSafeSshHost,
  sshVpnProxyCommand,
  sshVpnTunnelArgs
} from '../../shared/ssh-vpn-command-format'
import type { SshResolvedConfig } from '../ssh/ssh-config-parser'
import { resolveEffectiveProxy, type EffectiveProxy } from '../ssh/ssh-proxy-command'
import type { SshVpnLogins } from './ssh-vpn-logins'
import type { SshVpnManager } from './ssh-vpn-manager'
import {
  SshVpnProfileSwitchedError,
  type SshVpnRoute,
  type SshVpnStartOptions
} from './ssh-vpn-manager-types'
import type { SshVpnRouteProvider } from './ssh-vpn-route'
import type { SshVpnStore } from './ssh-vpn-store'

/** Asks the user to approve a VPN start; `hostLabel` names the connection that needs it. */
export type SshVpnStartApproval = (request: {
  profile: SshVpnProfile
  hostLabel: string | null
  /** An SSH host's connection: the user may pick another VPN for the host instead. */
  switchable: boolean
  commands: string[]
}) => Promise<SshVpnStartAnswer>

type SshVpnServiceDeps = {
  store: Pick<SshVpnStore, 'profileForTarget' | 'getProfile' | 'setAssignment'>
  manager: Pick<SshVpnManager, 'acquire' | 'getReadyRoute'>
  approveStart?: SshVpnStartApproval
  /** A host was switched to another VPN from the start confirmation. */
  onAssignmentChanged?: () => void
  logins?: Pick<SshVpnLogins, 'startOptions'>
  platform?: NodeJS.Platform
}

type RoutedHost = { profile: SshVpnProfile; route: SshVpnRoute }

function sameCommands(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((command, index) => command === b[index])
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
    const routed = await this.routeFor(target, resolved)
    return routed
      ? {
          kind: 'argv',
          program: routed.route.dockerPath,
          args: sshVpnTunnelArgs(routed.route.containerName, '%h', '%p')
        }
      : null
  }

  /** For the SSH page, which types `ssh` into a terminal instead of connecting itself. */
  async prepareTerminal(
    target: SshTarget,
    resolved: SshResolvedConfig | null
  ): Promise<SshVpnTerminalRoute | null> {
    const routed = await this.routeFor(target, resolved)
    return routed ? { profileName: routed.profile.name, ...routed.route } : null
  }

  /**
   * Brings a profile up by id: the Connect button (no label), or a connection that names its
   * VPN itself, e.g. a database connection. Returns the profile's name.
   */
  async connect(profileId: string, connectionLabel: string | null = null): Promise<string> {
    const profile = this.deps.store.getProfile(profileId)
    if (!profile) {
      throw new Error('This VPN profile no longer exists')
    }
    await this.deps.manager.acquire(profile, this.startOptions(profile, connectionLabel))
    return profile.name
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
    resolved: SshResolvedConfig | null,
    approvedCommands: readonly string[] | null = null
  ): Promise<RoutedHost | null> {
    const profile = this.deps.store.profileForTarget(target.id)
    if (!profile) {
      return null
    }
    assertNoCompetingProxy(target, resolved, profile)
    assertSafeHost(target, resolved, profile)
    try {
      const options = this.hostStartOptions(target, profile, approvedCommands)
      return { profile, route: await this.deps.manager.acquire(profile, options) }
    } catch (error) {
      // Why recurse: each switch is the user picking another VPN, which is routed like a fresh one.
      if (error instanceof SshVpnProfileSwitchedError) {
        return this.routeFor(target, resolved, error.approvedCommands)
      }
      throw error
    }
  }

  private hostStartOptions(
    target: SshTarget,
    profile: SshVpnProfile,
    approvedCommands: readonly string[] | null
  ): SshVpnStartOptions {
    const approve = this.deps.approveStart
    const logins = this.deps.logins?.startOptions(profile, target.label)
    if (!approve) {
      return { ...logins }
    }
    let approved = approvedCommands
    const confirm = async (commands: string[]): Promise<boolean> => {
      // Why: a start queued behind a switch must not ask about the VPN this host just left.
      if (this.deps.store.profileForTarget(target.id)?.id !== profile.id) {
        throw new SshVpnProfileSwitchedError(null)
      }
      // Why only an exact match: anything else (e.g. the image went missing) was never shown.
      const shownAlready = approved !== null && sameCommands(approved, commands)
      approved = null
      if (shownAlready) {
        return true
      }
      const answer = await approve({ profile, hostLabel: target.label, switchable: true, commands })
      if (answer.approved && answer.switchTo && answer.switchTo.profileId !== profile.id) {
        this.switchHost(target, answer.switchTo.profileId)
        throw new SshVpnProfileSwitchedError(answer.switchTo.commands)
      }
      return answer.approved
    }
    return { confirm, ...logins }
  }

  private switchHost(target: SshTarget, profileId: string): void {
    // Why ask again: a VPN deleted while the confirmation was open must not leave the host unrouted.
    if (!this.deps.store.getProfile(profileId)) {
      throw new SshVpnProfileSwitchedError(null)
    }
    this.deps.store.setAssignment(target.id, profileId)
    this.deps.onAssignmentChanged?.()
  }

  private startOptions(profile: SshVpnProfile, connectionLabel: string | null): SshVpnStartOptions {
    const approve = this.deps.approveStart
    return {
      confirm: approve
        ? async (commands) => {
            const answer = await approve({
              profile,
              hostLabel: connectionLabel,
              switchable: false,
              commands
            })
            return answer.approved && !answer.switchTo
          }
        : undefined,
      ...this.deps.logins?.startOptions(profile, connectionLabel)
    }
  }
}
