import { useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { RemoteHostsPageFrame } from './RemoteHostsPageFrame'
import { SshHostListPanel } from './SshHostListPanel'

export default function SshPage(): React.JSX.Element {
  const [currentTargetId, setCurrentTargetId] = useState<string | null>(null)

  return (
    <RemoteHostsPageFrame
      icon={SquareTerminal}
      title={translate('sshPage.page.title', 'SSH')}
      description={translate(
        'sshPage.page.description',
        'Open terminal sessions on your SSH hosts.'
      )}
      desktopOnlyMessage={translate(
        'sshPage.page.desktopOnly',
        'SSH sessions are available in the desktop app only.'
      )}
    >
      <div className="flex min-h-0 flex-1">
        <SshHostListPanel
          currentTargetId={currentTargetId}
          onSelect={(target) => setCurrentTargetId(target.id)}
        />
        <div className="flex min-w-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          {translate('sshPage.page.pickHost', 'Pick a host to open an SSH session.')}
        </div>
      </div>
    </RemoteHostsPageFrame>
  )
}
