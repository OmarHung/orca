import { useCallback, useMemo, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/class-names'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ResizeHandle } from '../bottom-panel/ResizeHandle'
import { useDragResize } from '../bottom-panel/use-drag-resize'
import { SftpTabPanels, type RemoteFilesTab } from '../sftp-page/SftpTabPanels'
import { RemoteGridHint } from './RemoteGridControls'
import {
  DEFAULT_REMOTE_DOCK_HEIGHT,
  remoteDockHeightForTab,
  remoteLayoutForTab,
  remoteSessionForTab,
  useRemoteSessionStore
} from './remote-session-store'
import { RemoteSyncBar } from './RemoteSyncBar'
import { RemoteTerminalArea } from './RemoteTerminalArea'
import {
  canReconnectInPlace,
  useSshSessionLivenessPolling,
  useSshSessionLivenessStore
} from './ssh-session-liveness'
import { useSshSyncStore } from './ssh-sync-store'
import { useSshSyncReceivingTabIds } from './use-ssh-sync'
import { useSshTerminalCwdReports } from './use-ssh-terminal-cwd-reports'
import { SshSessionEndedBanner } from './SshSessionEndedBanner'
import type { SshTargetListStatus } from './use-ssh-target-list'
import type { SshSessionItem } from './use-ssh-session-items'

const MIN_DOCK_HEIGHT = 160
const MIN_TERMINAL_HEIGHT = 120

type RemoteSessionPanelsProps = {
  isVisible: boolean
  items: {
    tabs: readonly Pick<TerminalTab, 'id' | 'generation' | 'ptyId' | 'createdAt'>[]
    terminalItems: readonly Pick<SshSessionItem, 'id' | 'quickCommandLabel'>[]
    activeTerminalId: string | null
    parkedTerminalTabIds: ReadonlySet<string>
  }
  targetsById: ReadonlyMap<string, SshTarget>
  targetsStatus: SshTargetListStatus
  onStartTerminal: (tabId: string, target: SshTarget) => void
  onReconnect: (tabId: string, target: SshTarget) => void
  onAddCurrentToGrid: () => void
  onReturnToGrid: () => void
  onJoinSync: (tabId: string) => void
}

/**
 * The files area's top edge. Applies a drag on release only: moving the area per frame would
 * resize the remote shell's PTY each time. Holds the drag state, so a drag re-renders only this.
 */
function DockResizeHandle({
  tabId,
  dockHeight,
  containerRef
}: {
  tabId: string
  dockHeight: number
  containerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const setSize = useCallback(
    (next: number) => useRemoteSessionStore.getState().setDockHeight(tabId, next),
    [tabId]
  )
  const { size, handleProps } = useDragResize({
    axis: 'y',
    size: dockHeight,
    setSize,
    min: MIN_DOCK_HEIGHT,
    getMax: () => (containerRef.current?.clientHeight ?? 0) - MIN_TERMINAL_HEIGHT,
    direction: -1
  })
  return (
    <>
      <ResizeHandle
        edge="top"
        label={translate('sshPage.layout.resizeFiles', 'Resize the files area')}
        handleProps={handleProps}
      />
      {size === dockHeight ? null : (
        // Why bottom: this area sits at the bottom of the page, so the guide lands at the new edge.
        <div
          data-remote-dock-guide
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-20 h-px bg-ring"
          style={{ bottom: size }}
        />
      )}
    </>
  )
}

/** The active tab's terminal and files, in the layout that tab chose. Both start on first use. */
export function RemoteSessionPanels({
  isVisible,
  items,
  targetsById,
  targetsStatus,
  onStartTerminal,
  onReconnect,
  onAddCurrentToGrid,
  onReturnToGrid,
  onJoinSync
}: RemoteSessionPanelsProps): React.JSX.Element {
  const sessions = useRemoteSessionStore((s) => s.sessions)
  const grid = useRemoteSessionStore((s) => s.grid)
  const { tabs, terminalItems, activeTerminalId, parkedTerminalTabIds } = items
  useSshTerminalCwdReports(isVisible ? terminalItems.map((item) => item.id) : [])
  const active = activeTerminalId ? remoteSessionForTab(sessions, activeTerminalId) : null
  const layout = activeTerminalId
    ? remoteLayoutForTab(sessions, grid, activeTerminalId)
    : 'terminal'
  const shownGridTabIds =
    activeTerminalId && grid?.tabIds.includes(activeTerminalId) ? grid.tabIds : null
  const dockHeight = activeTerminalId
    ? remoteDockHeightForTab(sessions, grid, activeTerminalId)
    : DEFAULT_REMOTE_DOCK_HEIGHT
  const containerRef = useRef<HTMLDivElement>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTerminalId)
  const hasRunningTerminal = active?.terminalStarted === true
  useSshSessionLivenessPolling(
    active?.tabId ?? null,
    activeTab?.ptyId ?? null,
    // Why: a grid's panes each watch themselves, and this tab's pane is one of them.
    isVisible && hasRunningTerminal && !shownGridTabIds,
    activeTab?.createdAt
  )
  const observation = useSshSessionLivenessStore((s) =>
    activeTerminalId ? s.byTab[activeTerminalId] : undefined
  )
  const isSyncOn = useSshSyncStore((s) => s.isOn)
  const labelOf = (tabId: string): string =>
    terminalItems.find((item) => item.id === tabId)?.quickCommandLabel ?? tabId
  const syncHostLabels = useSshSyncReceivingTabIds(shownGridTabIds ?? []).map(labelOf)
  const activeTarget = active ? targetsById.get(active.targetId) : undefined
  const activeItem = terminalItems.find((item) => item.id === activeTerminalId)

  const filesTabs = useMemo<RemoteFilesTab[]>(
    () =>
      terminalItems.map((item) => ({
        id: item.id,
        targetId: remoteSessionForTab(sessions, item.id).targetId,
        label: item.quickCommandLabel ?? ''
      })),
    [sessions, terminalItems]
  )

  return (
    <div ref={containerRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {grid && !shownGridTabIds && activeTerminalId ? (
        <RemoteGridHint
          isSyncPaused={isSyncOn}
          onAddCurrent={onAddCurrentToGrid}
          onReturn={onReturnToGrid}
        />
      ) : null}
      <div
        data-remote-terminals
        data-ssh-liveness={hasRunningTerminal ? observation?.liveness : undefined}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col bg-background',
          layout === 'files' && 'hidden'
        )}
      >
        {isSyncOn && shownGridTabIds ? (
          <RemoteSyncBar hostLabels={syncHostLabels} labelOf={labelOf} />
        ) : null}
        {hasRunningTerminal && !shownGridTabIds && observation?.liveness === 'ended' ? (
          <SshSessionEndedBanner
            hostLabel={activeTarget?.label ?? activeItem?.quickCommandLabel ?? ''}
            canReconnect={canReconnectInPlace(observation.foreground)}
            onReconnect={
              active && activeTarget ? () => onReconnect(active.tabId, activeTarget) : undefined
            }
          />
        ) : null}
        <RemoteTerminalArea
          isVisible={isVisible}
          tabs={tabs}
          terminalItems={terminalItems}
          activeTerminalId={activeTerminalId}
          parkedTerminalTabIds={parkedTerminalTabIds}
          shownGridTabIds={shownGridTabIds}
          targetsById={targetsById}
          onStartTerminal={onStartTerminal}
          onReconnect={onReconnect}
          onJoinSync={onJoinSync}
        />
      </div>
      <div
        data-remote-files
        className={cn(
          'relative flex min-h-0 min-w-0',
          layout === 'terminal' && 'hidden',
          layout === 'files' && 'flex-1',
          layout === 'split' && 'shrink-0 border-t border-border'
        )}
        style={
          layout === 'split'
            ? {
                height: dockHeight,
                maxHeight: `calc(100% - ${MIN_TERMINAL_HEIGHT}px)`
              }
            : undefined
        }
      >
        {layout === 'split' && active ? (
          <DockResizeHandle
            tabId={active.tabId}
            dockHeight={dockHeight}
            containerRef={containerRef}
          />
        ) : null}
        <SftpTabPanels
          tabs={filesTabs}
          activeTabId={layout === 'terminal' ? null : activeTerminalId}
          isPageVisible={isVisible}
          targetsById={targetsById}
          targetsStatus={targetsStatus}
        />
      </div>
    </div>
  )
}
