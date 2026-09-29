import { useState } from 'react'
import { FolderSync } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { RemoteHostsPageFrame } from '../ssh-page/RemoteHostsPageFrame'
import { SshHostListPanel } from '../ssh-page/SshHostListPanel'

export default function SftpPage(): React.JSX.Element {
  const [currentTargetId, setCurrentTargetId] = useState<string | null>(null)

  return (
    <RemoteHostsPageFrame
      icon={FolderSync}
      title={translate('sftpPage.page.title', 'SFTP')}
      description={translate(
        'sftpPage.page.description',
        'Upload and download files on your SSH hosts.'
      )}
      desktopOnlyMessage={translate(
        'sftpPage.page.desktopOnly',
        'File transfers are available in the desktop app only.'
      )}
    >
      <div className="flex min-h-0 flex-1">
        <SshHostListPanel
          currentTargetId={currentTargetId}
          onSelect={(target) => setCurrentTargetId(target.id)}
        />
        <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {currentTargetId
            ? translate('sftpPage.page.comingSoon', 'File transfer is coming in the next update.')
            : translate('sftpPage.page.pickHost', 'Pick a host to browse its files.')}
        </div>
      </div>
    </RemoteHostsPageFrame>
  )
}
