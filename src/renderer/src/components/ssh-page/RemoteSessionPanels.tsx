import { useCallback, useMemo, useRef } from 'react'
import TerminalPane from '@/components/terminal-pane/TerminalPane'
import { shouldDeferParkedPtyExitTabClose } from '@/components/terminal-pane/terminal-parked-tab-watchers'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { isProvenProcessExit } from '../../../../shared/terminal-exit-cause'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ResizeHandle } from '../bottom-panel/ResizeHandle'
import { useDragResize } from '../bottom-panel/use-drag-resize'
import { SftpTabPanels, type RemoteFilesTab } from '../sftp-page/SftpTabPanels'
import { Button } from '../ui/button'
import {
  remoteSessionForTab,
  useRemoteSessionStore,
  type RemoteSession
} from './remote-session-store'
import { closeSshSession } from './ssh-session-actions'
import {
  canReconnectInPlace,
  useSshSessionLivenessPolling,
  useSshSessionLivenessStore
} from './ssh-session-liveness'
import { SshSessionEndedBanner } from './SshSessionEndedBanner'
import type { SshTargetListStatus } from './use-ssh-target-list'
import { useSshSessionCwd } from './use-ssh-session-cwd'
import type { SshSessionItem } from './use-ssh-session-items'

const MIN_DOCK_HEIGHT = 160
const MIN_TERMINAL_HEIGHT = 120

type RemoteSessionPanelsProps = {
  isVisible: boolean
  items: {
    tabs: readonly Pick<TerminalTab, 'id' | 'generation' | 'ptyId'>[]
    terminalItems: readonly Pick<SshSessionItem, 'id' | 'quickCommandLabel'>[]
    activeTerminalId: string | null
    parkedTerminalTabIds: ReadonlySet<string>
  }
  targetsById: ReadonlyMap<string, SshTarget>
  targetsStatus: SshTargetListStatus
  onStartTerminal: (tabId: string, target: SshTarget) => void
  onReconnect: (tabId: string, target: SshTarget) => void
}

function TerminalNotStarted({
  session,
  target,
  onStart
}: {
  session: RemoteSession
  target: SshTarget | undefined
  onStart: (tabId: string, target: SshTarget) => void
}): React.JSX.Element {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground">
      <p>{translate('sshPage.session.notStarted', 'This tab has no terminal running.')}</p>
      {target ? (
        <Button size="sm" onClick={() => onStart(session.tabId, target)}>
          {translate('sshPage.session.connectTo', 'Connect to {{host}}', { host: target.label })}
        </Button>
      ) : null}
    </div>
  )
}

/**
 * The files area's top edge. Applies a drag on release only: moving the area per frame would
 * resize the remote shell's PTY each time. Holds the drag state, so a drag re-renders only this.
 */
function DockResizeHandle({
  session,
  containerRef
}: {
  session: RemoteSession
  containerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const { tabId, dockHeight } = session
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

function handleTerminalExit(tabId: string, ptyId: string, exitCode: number | undefined): void {
  if (exitCode !== undefined && !isProvenProcessExit(exitCode)) {
    useAppStore.getState().markUnverifiedPtyLoss(tabId)
    return
  }
  if (shouldDeferParkedPtyExitTabClose(tabId, ptyId)) {
    return
  }
  const { sessions, remotePathByTab, markTerminalStopped } = useRemoteSessionStore.getState()
  // Why: a tab that has shown files is also a file workbench; its terminal ending must not take
  // those away. Only a terminal-only tab closes with its shell.
  if (remoteSessionForTab(sessions, tabId).layout !== 'terminal' || remotePathByTab[tabId]) {
    useAppStore.getState().clearTabPtyId(tabId, ptyId)
    markTerminalStopped(tabId)
    return
  }
  closeTerminalTab(tabId, { reason: 'pty-exit', lifecyclePtyId: ptyId })
}

/** The active tab's terminal and files, in the layout that tab chose. Both start on first use. */
export function RemoteSessionPanels({
  isVisible,
  items,
  targetsById,
  targetsStatus,
  onStartTerminal,
  onReconnect
}: RemoteSessionPanelsProps): React.JSX.Element {
  const cwd = useSshSessionCwd()
  const sessions = useRemoteSessionStore((s) => s.sessions)
  const { tabs, terminalItems, activeTerminalId, parkedTerminalTabIds } = items
  const active = activeTerminalId ? remoteSessionForTab(sessions, activeTerminalId) : null
  const layout = active?.layout ?? 'terminal'
  const containerRef = useRef<HTMLDivElement>(null)
  const activeTab = tabs.find((tab) => tab.id === activeTerminalId)
  const hasRunningTerminal = active?.terminalStarted === true
  useSshSessionLivenessPolling(
    active?.tabId ?? null,
    activeTab?.ptyId ?? null,
    isVisible && hasRunningTerminal
  )
  const observation = useSshSessionLivenessStore((s) =>
    activeTerminalId ? s.byTab[activeTerminalId] : undefined
  )
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
      <div
        data-remote-terminals
        data-ssh-liveness={hasRunningTerminal ? observation?.liveness : undefined}
        className={cn(
          'flex min-h-0 min-w-0 flex-1 flex-col bg-background',
          layout === 'files' && 'hidden'
        )}
      >
        {hasRunningTerminal && observation?.liveness === 'ended' ? (
          <SshSessionEndedBanner
            hostLabel={activeTarget?.label ?? activeItem?.quickCommandLabel ?? ''}
            canReconnect={canReconnectInPlace(observation.foreground)}
            onReconnect={
              active && activeTarget ? () => onReconnect(active.tabId, activeTarget) : undefined
            }
          />
        ) : null}
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {cwd
            ? tabs
                .filter(
                  (tab) =>
                    !parkedTerminalTabIds.has(tab.id) &&
                    remoteSessionForTab(sessions, tab.id).terminalStarted
                )
                .map((tab) => {
                  const isCurrentTab = tab.id === activeTerminalId
                  const isShown = isCurrentTab && layout !== 'files'
                  return (
                    <div
                      key={`${tab.id}-${tab.generation ?? 0}`}
                      className={isCurrentTab ? 'absolute inset-0' : 'absolute inset-0 hidden'}
                      aria-hidden={!isShown}
                    >
                      <TerminalPane
                        tabId={tab.id}
                        worktreeId={SSH_SESSIONS_WORKTREE_ID}
                        cwd={cwd}
                        isActive={isShown}
                        isVisible={isShown && isVisible}
                        onPtyExit={(ptyId, exitCode) => handleTerminalExit(tab.id, ptyId, exitCode)}
                        onCloseTab={() => closeSshSession(tab.id)}
                      />
                    </div>
                  )
                })
            : null}
          {active && !active.terminalStarted ? (
            <TerminalNotStarted
              session={active}
              target={targetsById.get(active.targetId)}
              onStart={onStartTerminal}
            />
          ) : null}
          {terminalItems.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              {translate('sshPage.page.pickHost', 'Pick a host to open an SSH session.')}
            </div>
          ) : null}
        </div>
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
                height: active?.dockHeight,
                maxHeight: `calc(100% - ${MIN_TERMINAL_HEIGHT}px)`
              }
            : undefined
        }
      >
        {layout === 'split' && active ? (
          <DockResizeHandle session={active} containerRef={containerRef} />
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
