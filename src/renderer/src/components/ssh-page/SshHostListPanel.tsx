import type { SshTarget } from '../../../../shared/ssh-types'
import { Button } from '../ui/button'
import { translate } from '@/i18n/i18n'
import { SshHostList } from './SshHostList'
import type { SshTargetList } from './use-ssh-target-list'

type SshHostListPanelProps = {
  list: SshTargetList
  currentTargetId?: string | null
  onSelect: (target: SshTarget) => void
}

/** The host column of the SSH and SFTP pages, including its loading and empty states. */
export function SshHostListPanel({
  list,
  currentTargetId,
  onSelect
}: SshHostListPanelProps): React.JSX.Element {
  const { status, targets, reload } = list

  return (
    <div className="flex w-72 shrink-0 flex-col border-r border-border">
      {status === 'loading' ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {translate('sshPage.hostList.loading', 'Loading hosts…')}
        </p>
      ) : status === 'error' ? (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">
            {translate('sshPage.hostList.loadFailed', "Couldn't load your SSH hosts.")}
          </p>
          <Button variant="outline" size="xs" onClick={reload}>
            {translate('sshPage.hostList.retry', 'Retry')}
          </Button>
        </div>
      ) : targets.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {translate(
            'sshPage.hostList.empty',
            'No SSH hosts yet. Add them to ~/.ssh/config or in Settings → SSH.'
          )}
        </p>
      ) : (
        <SshHostList targets={targets} currentTargetId={currentTargetId} onSelect={onSelect} />
      )}
    </div>
  )
}
