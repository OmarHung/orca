import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { SshVpnStatus } from '../../../../shared/ssh-vpn-types'

export function describeSshVpnStatus(status: SshVpnStatus): string {
  switch (status) {
    case 'ready':
      return translate('sshVpn.status.ready', 'Connected')
    case 'starting':
      return translate('sshVpn.status.starting', 'Connecting…')
    case 'stopping':
      return translate('sshVpn.status.stopping', 'Disconnecting…')
    case 'error':
      return translate('sshVpn.status.error', 'Failed')
    case 'stopped':
      return translate('sshVpn.status.stopped', 'Not connected')
  }
}

export function SshVpnStatusDot({
  status,
  className
}: {
  status: SshVpnStatus
  className?: string
}): React.JSX.Element {
  const label = describeSshVpnStatus(status)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-ssh-vpn-status={status}
      className={cn(
        'inline-block size-1.5 shrink-0 rounded-full bg-muted-foreground/40',
        status === 'ready' && 'bg-status-success',
        (status === 'starting' || status === 'stopping') && 'animate-pulse bg-status-warning',
        status === 'error' && 'bg-destructive',
        className
      )}
    />
  )
}
