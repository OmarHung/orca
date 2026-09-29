import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { HostListToggleButton } from '../ssh-page/HostListToggleButton'
import { useRemoteHostsLayout } from '../ssh-page/remote-hosts-layout-store'
import { RemoteHostsPageFrame } from '../ssh-page/RemoteHostsPageFrame'
import { SshHostListPanel } from '../ssh-page/SshHostListPanel'
import { useSshTargetList } from '../ssh-page/use-ssh-target-list'
import { SftpWorkbench } from './SftpWorkbench'
import { useSftpProgressEvents } from './use-sftp-progress-events'

export default function SftpPage({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const list = useSshTargetList(isVisible)
  const isHostListCollapsed = useRemoteHostsLayout((s) => s.hostListCollapsed.sftp)
  const [currentTargetId, setCurrentTargetId] = useState<string | null>(null)
  useSftpProgressEvents()

  const target = list.targets.find((candidate) => candidate.id === currentTargetId) ?? null
  const collapsedToggle = isHostListCollapsed ? <HostListToggleButton page="sftp" /> : undefined

  return (
    <RemoteHostsPageFrame
      desktopOnlyMessage={translate(
        'sftpPage.page.desktopOnly',
        'File transfers are available in the desktop app only.'
      )}
    >
      <div className="flex min-h-0 flex-1">
        {isHostListCollapsed ? null : (
          <SshHostListPanel
            list={list}
            toggle={<HostListToggleButton page="sftp" />}
            currentTargetId={currentTargetId}
            onSelect={(picked) => setCurrentTargetId(picked.id)}
          />
        )}
        {target ? (
          <SftpWorkbench key={target.id} target={target} hostToggle={collapsedToggle} />
        ) : (
          <div className="relative flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
            {collapsedToggle ? (
              <div className="absolute top-1 left-1">{collapsedToggle}</div>
            ) : null}
            {translate('sftpPage.page.pickHost', 'Pick a host to browse its files.')}
          </div>
        )}
      </div>
    </RemoteHostsPageFrame>
  )
}
