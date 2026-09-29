import { useCallback, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { HostListToggleButton } from './HostListToggleButton'
import { useRemoteHostsLayout } from './remote-hosts-layout-store'
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
  const isHostListCollapsed = useRemoteHostsLayout((s) => s.hostListCollapsed.ssh)
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
      desktopOnlyMessage={translate(
        'sshPage.page.desktopOnly',
        'SSH sessions are available in the desktop app only.'
      )}
    >
      <div className="flex min-h-0 flex-1">
        {isHostListCollapsed ? null : (
          <SshHostListPanel
            page="ssh"
            list={list}
            currentTargetId={currentTargetId}
            onSelect={openSshSession}
          />
        )}
        <SshSessionsSurface
          isVisible={isVisible}
          items={items}
          onNewSession={openPicker}
          leadingControl={isHostListCollapsed ? <HostListToggleButton page="ssh" /> : null}
        />
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
