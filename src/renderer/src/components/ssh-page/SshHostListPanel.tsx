import type { SshTarget } from '../../../../shared/ssh-types'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'
import { HostListToggleButton } from './HostListToggleButton'
import type { RemoteHostsPageId } from './remote-hosts-layout-store'
import { SshHostList } from './SshHostList'
import type { SshTargetList } from './use-ssh-target-list'

type SshHostListPanelProps = {
  page: RemoteHostsPageId
  list: SshTargetList
  currentTargetId?: string | null
  onSelect: (target: SshTarget) => void
}

function StatusMessage({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-4 py-6 text-center text-xs text-muted-foreground">{children}</p>
}

/** The host column of the SSH and SFTP pages, including its loading and empty states. */
export function SshHostListPanel({
  page,
  list,
  currentTargetId,
  onSelect
}: SshHostListPanelProps): React.JSX.Element {
  const { status, targets, reload } = list
  const toggle = <HostListToggleButton page={page} />

  if (status === 'ready' && targets.length > 0) {
    return (
      <div className="flex w-72 shrink-0 flex-col border-r border-border">
        <SshHostList
          targets={targets}
          currentTargetId={currentTargetId}
          onSelect={onSelect}
          searchAccessory={toggle}
        />
      </div>
    )
  }

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      <div className="flex shrink-0 justify-end p-2">{toggle}</div>
      {status === 'loading' ? (
        <StatusMessage>{translate('sshPage.hostList.loading', 'Loading hosts…')}</StatusMessage>
      ) : status === 'error' ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {translate('sshPage.hostList.loadFailed', "Couldn't load your SSH hosts.")}
          </p>
          <Button variant="outline" size="xs" onClick={reload}>
            {translate('sshPage.hostList.retry', 'Retry')}
          </Button>
        </div>
      ) : (
        <StatusMessage>
          {translate(
            'sshPage.hostList.empty',
            'No SSH hosts yet. Add them to ~/.ssh/config or in Settings → SSH.'
          )}
        </StatusMessage>
      )}
    </div>
  )
}
