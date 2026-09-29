import { toast } from 'sonner'
import { sshVpnTerminalProxyOption } from '../../../../shared/ssh-vpn-command-format'
import type { SshTarget } from '../../../../shared/ssh-types'

export type SshSessionVpn = { profileName: string; sshOption: string }

function terminalPlatform(): NodeJS.Platform {
  return navigator.userAgent.includes('Windows') ? 'win32' : 'linux'
}

/**
 * Starts the host's VPN (main asks the user first) and returns the `-o ProxyCommand=…` to type.
 * Null when the host connects directly; 'cancelled' when the VPN did not start.
 */
export async function prepareSshSessionVpn(
  target: SshTarget
): Promise<SshSessionVpn | null | 'cancelled'> {
  // Why: the web client and unit tests have no sshVpn bridge, and no VPN can apply there.
  if (typeof window === 'undefined' || !window.api?.sshVpn) {
    return null
  }
  const result = await window.api.sshVpn.prepareTerminal(target.id)
  if (!result.ok) {
    if (!result.error.declined) {
      toast.error(result.error.message)
    }
    return 'cancelled'
  }
  return result.value
    ? {
        profileName: result.value.profileName,
        sshOption: sshVpnTerminalProxyOption(result.value, terminalPlatform())
      }
    : null
}
