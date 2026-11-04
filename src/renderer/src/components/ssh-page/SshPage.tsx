import { useCallback, useMemo, useState } from 'react'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useCommandConfirm } from '../command-confirm/command-confirm-context'
import { translate } from '@/i18n/i18n'
import { CommandConfirmProvider } from '../command-confirm/CommandConfirmProvider'
import { useSftpProgressEvents } from '../sftp-page/use-sftp-progress-events'
import { SshCommandList } from '../ssh-commands/SshCommandList'
import { ContextMenuItem } from '../ui/context-menu'
import { HostListToggleButton } from './HostListToggleButton'
import { useRemoteHostsLayout } from './remote-hosts-layout-store'
import { RemoteGridControls, RemoteHostSelectionBar } from './RemoteGridControls'
import { RemoteHostsPageFrame } from './RemoteHostsPageFrame'
import { RemoteSidePanel } from './RemoteSidePanel'
import { RemoteSyncDialog, type RemoteSyncRequest } from './RemoteSyncDialog'
import { RemoteLayoutToggle } from './RemoteLayoutToggle'
import { RemoteTransfersTray } from './RemoteTransfersTray'
import {
  remoteLayoutForTab,
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
import { addTabToGrid, openHostsInGrid, returnToGrid } from './ssh-grid-actions'
import { sshHostGroupIdOf, sshHostGroupSubtreeIds } from './ssh-host-groups'
import { useSshHostGroups } from './ssh-host-groups-store'
import { useSshSyncStore } from './ssh-sync-store'
import { useRemoteSessionSync } from './use-remote-session-sync'
import { isSshSyncSupported, useSshSync } from './use-ssh-sync'
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
  const grid = useRemoteSessionStore((s) => s.grid)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [gridPickerOpen, setGridPickerOpen] = useState(false)
  const [syncRequest, setSyncRequest] = useState<RemoteSyncRequest | null>(null)
  const isSyncOn = useSshSyncStore((s) => s.isOn)
  const [selectedHostIds, setSelectedHostIds] = useState<ReadonlySet<string>>(() => new Set())
  const confirm = useCommandConfirm()
  useSftpProgressEvents()
  useRemoteSessionSync(list)
  useSshSync(isVisible)

  const { activeTerminalId, terminalItems, tabBarOrder } = items
  const activeSession = activeTerminalId ? remoteSessionForTab(sessions, activeTerminalId) : null
  const isGridShown = activeTerminalId !== null && grid?.tabIds.includes(activeTerminalId) === true
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

  const toggleSelectedHost = useCallback((target: SshTarget) => {
    setSelectedHostIds((current) => {
      const next = new Set(current)
      if (!next.delete(target.id)) {
        next.add(target.id)
      }
      return next
    })
  }, [])
  const openSelectedHosts = useCallback(() => {
    const picked = list.targets.filter((target) => selectedHostIds.has(target.id))
    setSelectedHostIds(new Set())
    void openHostsInGrid(picked, confirm)
  }, [confirm, list.targets, selectedHostIds])
  const connectGroup = useCallback(
    (groupId: string) => {
      const groups = useSshHostGroups.getState().data
      const subtree = sshHostGroupSubtreeIds(groups, groupId)
      const inGroup = list.targets.filter((target) => {
        const hostGroup = sshHostGroupIdOf(groups, target.id)
        return hostGroup !== null && subtree.has(hostGroup)
      })
      void openHostsInGrid(inGroup, confirm)
    },
    [confirm, list.targets]
  )
  const addTab = useCallback(
    (tabId: string) => {
      const target = targetsById.get(remoteSessionForTab(sessions, tabId).targetId)
      void addTabToGrid(tabId, target, confirm, activeTerminalId)
    },
    [activeTerminalId, confirm, sessions, targetsById]
  )
  const syncPane = (tabId: string): RemoteSyncRequest['panes'][number] => {
    const item = terminalItems.find((tab) => tab.id === tabId)
    return {
      tabId,
      label: item?.quickCommandLabel ?? item?.title ?? tabId,
      ptyId: item?.ptyId ?? null
    }
  }
  const startSync = (): void => {
    setSyncRequest({ panes: (grid?.tabIds ?? []).map(syncPane), isJoining: false })
  }
  const joinSync = (tabId: string): void => {
    setSyncRequest({ panes: [syncPane(tabId)], isJoining: true })
  }
  const gridPickerTabs = terminalItems
    .filter((tab) => !grid?.tabIds.includes(tab.id) && (grid || tab.id !== activeTerminalId))
    .map((tab) => ({ id: tab.id, label: tab.quickCommandLabel ?? tab.title }))

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
          <div className="flex items-center gap-1.5">
            <RemoteGridControls
              hasGrid={grid !== null}
              isGridShown={isGridShown}
              hasTabs={terminalItems.length > 0}
              isSyncOn={isSyncOn}
              isSyncSupported={isSshSyncSupported()}
              onStartSync={startSync}
              onStopSync={() => useSshSyncStore.getState().stop()}
              onAdd={() => setGridPickerOpen(true)}
              onReturn={returnToGrid}
              onEnd={() => useRemoteSessionStore.getState().clearGrid()}
            />
            <RemoteLayoutToggle
              layout={
                activeTerminalId ? remoteLayoutForTab(sessions, grid, activeTerminalId) : null
              }
              onChange={setActiveLayout}
            />
          </div>
        }
        sidePanel={
          isHostListCollapsed ? null : (
            <RemoteSidePanel
              hosts={
                <SshHostListPanel
                  list={list}
                  currentTargetId={activeSession?.targetId ?? null}
                  onSelect={showHost}
                  hostMenuItems={hostMenuItems}
                  hostRowActions={hostRowActions}
                  selectedTargetIds={selectedHostIds}
                  onToggleSelected={toggleSelectedHost}
                  onConnectGroup={connectGroup}
                  selectionBar={
                    selectedHostIds.size > 0 ? (
                      <RemoteHostSelectionBar
                        count={selectedHostIds.size}
                        hasGrid={grid !== null}
                        onOpen={openSelectedHosts}
                        onClear={() => setSelectedHostIds(new Set())}
                      />
                    ) : null
                  }
                />
              }
              commands={
                <SshCommandList
                  activeTabId={activeTerminalId}
                  activeTarget={
                    activeSession ? (targetsById.get(activeSession.targetId) ?? null) : null
                  }
                  targets={list.targets}
                />
              }
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
          onAddCurrentToGrid={() => {
            if (activeTerminalId) {
              addTab(activeTerminalId)
            }
          }}
          onReturnToGrid={returnToGrid}
          onJoinSync={joinSync}
        />
      </SshSessionsSurface>
      <RemoteTransfersTray targetsById={targetsById} />
      <RemoteSyncDialog request={syncRequest} onClose={() => setSyncRequest(null)} />
      <SshHostPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        targets={list.targets}
        onSelect={openNewSession}
      />
      <SshHostPickerDialog
        open={gridPickerOpen}
        onOpenChange={setGridPickerOpen}
        targets={list.targets}
        title={translate('sshPage.grid.pickerTitle', 'Show side by side')}
        description={translate(
          'sshPage.grid.pickerDescription',
          'Pick an open tab, which needs no new connection, or a host.'
        )}
        openTabs={gridPickerTabs}
        onSelectTab={addTab}
        onSelect={(target) => void openHostsInGrid([target], confirm, activeTerminalId)}
      />
    </RemoteHostsPageFrame>
  )
}
