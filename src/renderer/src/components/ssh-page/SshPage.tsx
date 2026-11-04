import { useCallback, useMemo, useState } from 'react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useCommandConfirm } from '../command-confirm/command-confirm-context'
import { translate } from '@/i18n/i18n'
import { CommandConfirmProvider } from '../command-confirm/CommandConfirmProvider'
import { useSftpProgressEvents } from '../sftp-page/use-sftp-progress-events'
import { ContextMenuItem } from '../ui/context-menu'
import { HostListToggleButton } from './HostListToggleButton'
import { useRemoteHostsLayout } from './remote-hosts-layout-store'
import { RemoteHostsPageFrame } from './RemoteHostsPageFrame'
import { RemoteLayoutToggle } from './RemoteLayoutToggle'
import { RemoteTransfersTray } from './RemoteTransfersTray'
import {
  remoteSessionForTab,
  useRemoteSessionStore,
  type RemoteLayout
} from './remote-session-store'
import { RemoteSessionPanels } from './RemoteSessionPanels'
import { SshHostListPanel } from './SshHostListPanel'
import { SshHostPickerDialog } from './SshHostPickerDialog'
import { SshHostRowActions } from './SshHostRowActions'
import { SshSessionsSurface } from './SshSessionsSurface'
import {
  closeSshSession,
  openFilesSession,
  openSshSession,
  reconnectSessionTerminal,
  setSessionLayout,
  showHostSession,
  startSessionTerminal
} from './ssh-session-actions'
import { useRemoteSessionSync } from './use-remote-session-sync'
import { useSshPageShortcuts } from './use-ssh-page-shortcuts'
import { useSshSessionItems } from './use-ssh-session-items'
import { useSshTargetList } from './use-ssh-target-list'

export default function SshPage({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  return (
    <CommandConfirmProvider>
      <SshPageContent isVisible={isVisible} />
    </CommandConfirmProvider>
  )
}

function SshPageContent({ isVisible }: { isVisible: boolean }): React.JSX.Element {
  const list = useSshTargetList(isVisible)
  const items = useSshSessionItems(isVisible)
  const isHostListCollapsed = useRemoteHostsLayout((s) => s.isHostListCollapsed)
  const sessions = useRemoteSessionStore((s) => s.sessions)
  const [pickerOpen, setPickerOpen] = useState(false)
  const confirm = useCommandConfirm()
  useSftpProgressEvents()
  useRemoteSessionSync(list)

  const { activeTerminalId, terminalItems, tabBarOrder } = items
  const activeSession = activeTerminalId ? remoteSessionForTab(sessions, activeTerminalId) : null
  const targetsById = useMemo(
    () => new Map(list.targets.map((target) => [target.id, target])),
    [list.targets]
  )

  const openPicker = useCallback(() => setPickerOpen(true), [])
  const openNewSession = useCallback(
    (target: SshTarget) => void openSshSession(target, confirm),
    [confirm]
  )
  const showHost = useCallback(
    (target: SshTarget) =>
      void showHostSession(target, confirm, {
        orderedTabIds: tabBarOrder.length > 0 ? tabBarOrder : terminalItems.map((tab) => tab.id),
        activeTabId: activeTerminalId
      }),
    [activeTerminalId, confirm, tabBarOrder, terminalItems]
  )
  const startTerminal = useCallback(
    (tabId: string, target: SshTarget) => void startSessionTerminal(tabId, target, confirm),
    [confirm]
  )
  const reconnect = useCallback(
    (tabId: string, target: SshTarget) => void reconnectSessionTerminal(tabId, target, confirm),
    [confirm]
  )
  const closeActiveSession = useCallback(() => {
    if (activeTerminalId) {
      closeSshSession(activeTerminalId)
    }
  }, [activeTerminalId])
  const setActiveLayout = useCallback(
    (layout: RemoteLayout) => {
      if (activeTerminalId) {
        setSessionLayout(activeTerminalId, layout)
      }
    },
    [activeTerminalId]
  )
  useSshPageShortcuts({
    isVisible,
    onNewSession: openPicker,
    onCloseActiveSession: closeActiveSession,
    onSetLayout: setActiveLayout
  })

  const hostMenuItems = useCallback(
    (target: SshTarget) => (
      <>
        <ContextMenuItem onSelect={() => openNewSession(target)}>
          {translate('sshPage.hostRow.openTerminal', 'Open a terminal tab')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => openFilesSession(target)}>
          {translate('sshPage.hostRow.openFiles', 'Open a files tab')}
        </ContextMenuItem>
      </>
    ),
    [openNewSession]
  )
  const hostRowActions = useCallback(
    (target: SshTarget) => (
      <SshHostRowActions
        onOpenTerminal={() => openNewSession(target)}
        onOpenFiles={() => openFilesSession(target)}
      />
    ),
    [openNewSession]
  )

  return (
    <RemoteHostsPageFrame
      desktopOnlyMessage={translate(
        'sshPage.page.desktopOnly',
        'SSH sessions are available in the desktop app only.'
      )}
    >
      <SshSessionsSurface
        isVisible={isVisible}
        items={items}
        onNewSession={openPicker}
        leadingControl={<HostListToggleButton />}
        trailingControl={
          <RemoteLayoutToggle layout={activeSession?.layout ?? null} onChange={setActiveLayout} />
        }
        sidePanel={
          isHostListCollapsed ? null : (
            <SshHostListPanel
              list={list}
              currentTargetId={activeSession?.targetId ?? null}
              onSelect={showHost}
              hostMenuItems={hostMenuItems}
              hostRowActions={hostRowActions}
            />
          )
        }
      >
        <RemoteSessionPanels
          isVisible={isVisible}
          items={items}
          targetsById={targetsById}
          targetsStatus={list.status}
          onStartTerminal={startTerminal}
          onReconnect={reconnect}
        />
      </SshSessionsSurface>
      <RemoteTransfersTray targetsById={targetsById} />
      <SshHostPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        targets={list.targets}
        onSelect={openNewSession}
      />
    </RemoteHostsPageFrame>
  )
}
