import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { HostListToggleButton } from '../ssh-page/HostListToggleButton'
import { useRemoteHostsLayout } from '../ssh-page/remote-hosts-layout-store'
import { RemoteHostsPageFrame } from '../ssh-page/RemoteHostsPageFrame'
import { SshHostListPanel } from '../ssh-page/SshHostListPanel'
import { useSshTargetList } from '../ssh-page/use-ssh-target-list'

export default function SftpPage(): React.JSX.Element {
  const list = useSshTargetList()
  const isHostListCollapsed = useRemoteHostsLayout((s) => s.hostListCollapsed.sftp)
  const [currentTargetId, setCurrentTargetId] = useState<string | null>(null)

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
            onSelect={(target) => setCurrentTargetId(target.id)}
          />
        )}
        <div className="relative flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {isHostListCollapsed ? (
            <div className="absolute top-1 left-1">
              <HostListToggleButton page="sftp" />
            </div>
          ) : null}
          {currentTargetId
            ? translate('sftpPage.page.comingSoon', 'File transfer is coming in the next update.')
            : translate('sftpPage.page.pickHost', 'Pick a host to browse its files.')}
        </div>
      </div>
    </RemoteHostsPageFrame>
  )
}
