import { Loader2, Plug, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { PaneIconButton } from './SftpFilePane'
import { useSftpConnectionStore } from './sftp-connection-store'
import { useSftpTransfersStore } from './sftp-transfers-store'

function useConnectionStatus(targetId: string) {
  return useSftpConnectionStore((s) => s.byTarget[targetId])
}

/** Connected stays a quiet dot; the states that need attention say so in words. */
export function SftpConnectionStatusLabel({
  targetId
}: {
  targetId: string
}): React.JSX.Element | null {
  const connection = useConnectionStatus(targetId)
  if (!connection) {
    return null
  }
  if (connection.status === 'connected') {
    const label = translate('sftpPage.connection.connected', 'Connected')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={label}
            data-sftp-connection="connected"
            className="size-1.5 shrink-0 rounded-full bg-foreground"
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {label}
        </TooltipContent>
      </Tooltip>
    )
  }
  if (connection.status === 'connecting') {
    return (
      <span
        data-sftp-connection="connecting"
        className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground"
      >
        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
        {translate('sftpPage.connection.connecting', 'Connecting…')}
      </span>
    )
  }
  return (
    <span
      data-sftp-connection={connection.status}
      className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
    >
      {connection.status === 'failed'
        ? translate('sftpPage.connection.failed', 'Not connected')
        : translate('sftpPage.connection.disconnected', 'Disconnected')}
    </span>
  )
}

/** Ends this host's file connection, or starts it again. Browsing reconnects on its own too. */
export function SftpConnectionToggle({
  targetId,
  onReconnect
}: {
  targetId: string
  onReconnect: () => void
}): React.JSX.Element | null {
  const connection = useConnectionStatus(targetId)
  const hasRunningTransfer = useSftpTransfersStore((s) =>
    s.transfers.some((transfer) => transfer.targetId === targetId && transfer.status === 'running')
  )
  if (!connection) {
    return null
  }
  if (connection.status === 'disconnected' || connection.status === 'failed') {
    return (
      <PaneIconButton
        label={translate('sftpPage.connection.reconnect', 'Reconnect')}
        onClick={onReconnect}
      >
        <Plug className="size-3.5" />
      </PaneIconButton>
    )
  }
  return (
    <PaneIconButton
      label={translate('sftpPage.connection.disconnect', 'Disconnect')}
      onClick={() => {
        // Why not disabled: a disabled button shows no tooltip, so it could not say why.
        if (hasRunningTransfer) {
          toast.info(
            translate(
              'sftpPage.connection.busy',
              'Finish or cancel this host’s transfers to disconnect.'
            )
          )
          return
        }
        void window.api.sftp.disconnect(targetId)
      }}
    >
      <Unplug className="size-3.5" />
    </PaneIconButton>
  )
}
