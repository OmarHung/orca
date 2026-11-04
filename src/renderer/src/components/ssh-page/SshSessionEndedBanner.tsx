import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'

/** Says plainly that this tab is no longer on the host its title names. */
export function SshSessionEndedBanner({
  hostLabel,
  canReconnect,
  onReconnect
}: {
  hostLabel: string
  /** False while a local program runs, because the command would be typed into it. */
  canReconnect: boolean
  /** Absent when the tab's host is no longer known, so there is nothing to connect to. */
  onReconnect?: () => void
}): React.JSX.Element {
  return (
    <div
      role="status"
      data-ssh-session-ended
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[color-mix(in_srgb,var(--destructive)_10%,var(--background))] px-3 py-1.5 text-xs text-foreground"
    >
      <span className="min-w-0 flex-1">
        <span className="font-semibold">
          {translate('sshPage.session.ended', 'SSH connection ended.')}
        </span>{' '}
        {translate('sshPage.session.endedDetail', 'This tab is now a local shell, not {{host}}.', {
          host: hostLabel
        })}
        {onReconnect && !canReconnect ? (
          <span className="text-muted-foreground">
            {' '}
            {translate(
              'sshPage.session.reconnectBusy',
              'Something still seems to be running in this tab. Finish it first.'
            )}
          </span>
        ) : null}
      </span>
      {onReconnect ? (
        <Button size="xs" disabled={!canReconnect} onClick={onReconnect}>
          {translate('sshPage.session.reconnect', 'Reconnect')}
        </Button>
      ) : null}
    </div>
  )
}
