import type { SshVpnStatus } from '../../shared/ssh-vpn-types'
import type { SshVpnRoute } from './ssh-vpn-manager-types'

/**
 * The seam between database connections and the VPN runtime, which registers after the
 * database handlers; database code reads it when a connection opens.
 */
export type SshVpnDatabaseRoutes = {
  /** Starts the profile's VPN when it is not up (asking the user first); returns its name. */
  prepare(profileId: string, connectionLabel: string): Promise<{ profileName: string }>
  /** How to reach the VPN while it is ready; null otherwise. Never starts anything. */
  readyRoute(profileId: string): SshVpnRoute | null
  /** Calls `listener` on every state change of the profile's VPN; returns an unsubscribe. */
  watch(profileId: string, listener: (status: SshVpnStatus) => void): () => void
}

let routes: SshVpnDatabaseRoutes | null = null

export function setSshVpnDatabaseRoutes(next: SshVpnDatabaseRoutes | null): void {
  routes = next
}

export function getSshVpnDatabaseRoutes(): SshVpnDatabaseRoutes | null {
  return routes
}
