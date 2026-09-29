import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  isServerConnection,
  type DatabaseConnection
} from '../../../../../shared/database/database-connection-types'
import { useSshVpnStore } from '../../ssh-vpn/ssh-vpn-store'

/** "via <SSH host>" or "via VPN <profile>" beside a connection's name; null when it connects directly. */
export function useConnectionRouteLabel(connection: DatabaseConnection | undefined): string | null {
  const server = connection && isServerConnection(connection) ? connection : null
  const sshTargetId = server?.sshTunnel?.targetId
  const vpnProfileId = server?.vpnProfileId
  const sshLabel = useAppStore((state) =>
    sshTargetId ? (state.sshTargetLabels.get(sshTargetId) ?? null) : undefined
  )
  const vpnName = useSshVpnStore((state) =>
    vpnProfileId
      ? (state.profiles.find((profile) => profile.id === vpnProfileId)?.name ?? null)
      : undefined
  )
  if (sshLabel !== undefined) {
    return translate('database.explorer.viaSsh', 'via {{value0}}', {
      value0: sshLabel ?? translate('database.connectionForm.sshRemoved', 'Removed SSH host')
    })
  }
  if (vpnName !== undefined) {
    return translate('database.explorer.viaVpn', 'via VPN {{value0}}', {
      value0: vpnName ?? translate('database.connectionForm.vpnRemoved', 'Removed VPN profile')
    })
  }
  return null
}
