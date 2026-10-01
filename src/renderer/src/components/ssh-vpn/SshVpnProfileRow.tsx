import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { SshVpnProfile, SshVpnProfileState } from '../../../../shared/ssh-vpn-types'
import { describeSshVpnStatus, SshVpnStatusDot } from './SshVpnStatusDot'
import { sshVpnActions } from './ssh-vpn-store'

type SshVpnProfileRowProps = {
  profile: SshVpnProfile
  state: SshVpnProfileState
  hostCount: number
  onEdit: () => void
}

function idleSummary(minutes: number): string {
  return minutes === 0
    ? translate('sshVpn.row.idleNever', 'Stays connected until Orca quits')
    : translate('sshVpn.row.idleMinutes', 'Disconnects after {{minutes}} min idle', { minutes })
}

function sourceSummary(profile: SshVpnProfile): { source: string; lifetime: string } {
  return profile.kind === 'container'
    ? {
        source: translate('sshVpn.row.container', 'Container: {{name}}', {
          name: profile.containerName
        }),
        lifetime: translate('sshVpn.row.borrowed', 'Started and stopped outside Orca')
      }
    : { source: profile.ovpnPath, lifetime: idleSummary(profile.idleMinutes) }
}

export function SshVpnProfileRow({
  profile,
  state,
  hostCount,
  onEdit
}: SshVpnProfileRowProps): React.JSX.Element {
  const [isLogOpen, setIsLogOpen] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const isBusy = state.status === 'starting' || state.status === 'stopping'
  const isBorrowed = profile.kind === 'container'
  // Why: a borrowed container keeps running whatever Orca does, so its only action is a check.
  const isUp = state.status === 'ready' && !isBorrowed
  const { source, lifetime } = sourceSummary(profile)

  return (
    <li className="space-y-2 rounded-md border border-border p-3" data-ssh-vpn-profile={profile.id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <SshVpnStatusDot status={state.status} />
            <span className="truncate text-sm font-medium text-foreground">{profile.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {describeSshVpnStatus(state.status)}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground" title={source}>
            {source}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate('sshVpn.row.hosts', '{{count}} hosts', { count: hostCount })} · {lifetime}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="outline"
            size="xs"
            className="w-20"
            disabled={isBusy}
            onClick={() =>
              void (isUp ? sshVpnActions.disconnect(profile.id) : sshVpnActions.connect(profile.id))
            }
          >
            {isBorrowed
              ? translate('sshVpn.row.check', 'Check')
              : isUp
                ? translate('sshVpn.row.disconnect', 'Disconnect')
                : translate('sshVpn.row.connect', 'Connect')}
          </Button>
          <Button variant="ghost" size="xs" disabled={isBusy} onClick={onEdit}>
            {translate('sshVpn.row.edit', 'Edit')}
          </Button>
          {isConfirmingDelete ? (
            <>
              <Button variant="ghost" size="xs" onClick={() => setIsConfirmingDelete(false)}>
                {translate('sshVpn.row.cancelDelete', 'Keep')}
              </Button>
              <Button
                variant="destructive"
                size="xs"
                onClick={() => void sshVpnActions.deleteProfile(profile.id)}
              >
                {translate('sshVpn.row.confirmDelete', 'Delete')}
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="xs" onClick={() => setIsConfirmingDelete(true)}>
              {translate('sshVpn.row.delete', 'Delete…')}
            </Button>
          )}
        </div>
      </div>
      {isConfirmingDelete ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'sshVpn.row.deleteNote',
            'Hosts using this VPN go back to connecting directly.'
          )}
        </p>
      ) : null}
      {state.status === 'error' && state.error ? (
        <p className="text-xs break-all text-destructive">{state.error}</p>
      ) : null}
      {state.logTail.length > 0 ? (
        <div className="space-y-1">
          <Button variant="ghost" size="xs" onClick={() => setIsLogOpen((open) => !open)}>
            {isLogOpen
              ? translate('sshVpn.row.hideLog', 'Hide OpenVPN log')
              : translate('sshVpn.row.showLog', 'Show OpenVPN log')}
          </Button>
          {isLogOpen ? (
            <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] leading-4 whitespace-pre-wrap select-text">
              {state.logTail.join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
