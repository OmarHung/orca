import { useCallback, useState } from 'react'
import { SquareTerminal } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { RemoteHostsPageFrame } from './RemoteHostsPageFrame'
import { SshHostListPanel } from './SshHostListPanel'
import { SshHostPickerDialog } from './SshHostPickerDialog'
import { SshSessionsSurface } from './SshSessionsSurface'
import { closeSshSession, openSshSession } from './ssh-session-actions'
import { useSshPageShortcuts } from './use-ssh-page-shortcuts'
import { useSshSessionItems } from './use-ssh-session-items'
import { useSshTargetList } from './use-ssh-target-list'

export default function SshPage({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const list = useSshTargetList(isVisible)
  const items = useSshSessionItems(isVisible)
  const [pickerOpen, setPickerOpen] = useState(false)
  const openPicker = useCallback(() => setPickerOpen(true), [])
  const { activeTerminalId, terminalItems } = items
  const closeActiveSession = useCallback(() => {
    if (activeTerminalId) {
      closeSshSession(activeTerminalId)
    }
  }, [activeTerminalId])
  useSshPageShortcuts({
    isVisible,
    onNewSession: openPicker,
    onCloseActiveSession: closeActiveSession
  })

  const activeLabel = terminalItems.find((tab) => tab.id === activeTerminalId)?.quickCommandLabel
  const currentTargetId = list.targets.find((target) => target.label === activeLabel)?.id ?? null

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
        <SshHostListPanel list={list} currentTargetId={currentTargetId} onSelect={openSshSession} />
        <SshSessionsSurface isVisible={isVisible} items={items} onNewSession={openPicker} />
      </div>
      <SshHostPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        targets={list.targets}
        onSelect={openSshSession}
      />
    </RemoteHostsPageFrame>
  )
}
