import { useEffect, useRef, useState } from 'react'
import TerminalPane from '@/components/terminal-pane/TerminalPane'
import { shouldDeferParkedPtyExitTabClose } from '@/components/terminal-pane/parking/output-watchers/terminal-parked-tab-watchers'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { isProvenProcessExit } from '../../../../shared/terminal/pty/lifecycle/terminal-exit-cause'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { Button } from '../ui/button'
import { remoteGridCells, type RemoteGridCell } from './remote-grid'
import {
  remoteLayoutForTab,
  remoteSessionForTab,
  useRemoteSessionStore,
  type RemoteSession
} from './remote-session-store'
import { RemoteGridPaneHeader } from './RemoteGridPaneHeader'
import { activateSessionTab, closeSshSession } from './ssh-session-actions'
import { useSshSyncReceivingTabIds } from './use-ssh-sync'
import { useSshSessionCwd } from './use-ssh-session-cwd'
import type { SshSessionItem } from './use-ssh-session-items'

type RemoteTerminalAreaProps = {
  isVisible: boolean
  tabs: readonly Pick<TerminalTab, 'id' | 'generation' | 'ptyId' | 'createdAt'>[]
  terminalItems: readonly Pick<SshSessionItem, 'id' | 'quickCommandLabel'>[]
  activeTerminalId: string | null
  parkedTerminalTabIds: ReadonlySet<string>
  /** The tabs laid out together; null shows the active tab alone. */
  shownGridTabIds: readonly string[] | null
  targetsById: ReadonlyMap<string, SshTarget>
  onStartTerminal: (tabId: string, target: SshTarget) => void
  onReconnect: (tabId: string, target: SshTarget) => void
  onJoinSync: (tabId: string) => void
}

function handleTerminalExit(tabId: string, ptyId: string, exitCode: number | undefined): void {
  if (exitCode !== undefined && !isProvenProcessExit(exitCode)) {
    useAppStore.getState().markUnverifiedPtyLoss(tabId)
    return
  }
  if (shouldDeferParkedPtyExitTabClose(tabId, ptyId)) {
    return
  }
  const { sessions, grid, remotePathByTab, markTerminalStopped } = useRemoteSessionStore.getState()
  // Why: a tab that has shown files is also a file workbench; its terminal ending must not take
  // those away. Only a terminal-only tab closes with its shell.
  if (remoteLayoutForTab(sessions, grid, tabId) !== 'terminal' || remotePathByTab[tabId]) {
    useAppStore.getState().clearTabPtyId(tabId, ptyId)
    markTerminalStopped(tabId)
    return
  }
  closeTerminalTab(tabId, { reason: 'pty-exit', lifecyclePtyId: ptyId })
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

function useElementWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

function cellStyle(cell: RemoteGridCell): React.CSSProperties {
  return {
    top: `${cell.top}%`,
    left: `${cell.left}%`,
    width: `${cell.width}%`,
    height: `${cell.height}%`
  }
}

/**
 * Every running terminal, positioned rather than re-parented: a pane moving into or out of the grid
 * keeps the same mounted TerminalPane, so its PTY and scrollback are untouched.
 */
export function RemoteTerminalArea({
  isVisible,
  tabs,
  terminalItems,
  activeTerminalId,
  parkedTerminalTabIds,
  shownGridTabIds,
  targetsById,
  onStartTerminal,
  onReconnect,
  onJoinSync
}: RemoteTerminalAreaProps): React.JSX.Element {
  const cwd = useSshSessionCwd()
  const sessions = useRemoteSessionStore((s) => s.sessions)
  const grid = useRemoteSessionStore((s) => s.grid)
  const areaRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(areaRef)
  const layout = activeTerminalId
    ? remoteLayoutForTab(sessions, grid, activeTerminalId)
    : 'terminal'
  const cells = shownGridTabIds ? remoteGridCells(shownGridTabIds.length, width) : []
  const syncReceivingTabIds = useSshSyncReceivingTabIds(shownGridTabIds ?? [])

  return (
    <div ref={areaRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      {cwd
        ? tabs.map((tab) => {
            const gridIndex = shownGridTabIds?.indexOf(tab.id) ?? -1
            const cell = gridIndex >= 0 ? cells[gridIndex] : undefined
            const isCurrentTab = tab.id === activeTerminalId
            const isOnScreen = cell !== undefined || isCurrentTab
            const session = remoteSessionForTab(sessions, tab.id)
            if (parkedTerminalTabIds.has(tab.id) || (!session.terminalStarted && !isOnScreen)) {
              return null
            }
            const isShown = isOnScreen && layout !== 'files'
            const label =
              terminalItems.find((item) => item.id === tab.id)?.quickCommandLabel ?? tab.id
            return (
              <div
                key={`${tab.id}-${tab.generation ?? 0}`}
                data-remote-terminal-cell={tab.id}
                data-active={isCurrentTab ? 'true' : undefined}
                data-remote-sync-receiving={
                  syncReceivingTabIds.includes(tab.id) ? 'true' : undefined
                }
                className={cn(
                  'absolute',
                  !cell && 'inset-0',
                  !isOnScreen && 'hidden',
                  // Why hide: its × closes the tab beside ours that keeps it, and a split would
                  // leave commands unable to tell which pane to type into.
                  cell &&
                    'flex flex-col border-r border-b border-border [&_.pane-title-actions]:hidden',
                  // Why a frame: which panes get the keys must be visible without reading anything.
                  cell &&
                    syncReceivingTabIds.includes(tab.id) &&
                    'outline outline-1 -outline-offset-1 outline-destructive'
                )}
                style={cell ? cellStyle(cell) : undefined}
                aria-hidden={!isShown}
                onPointerDownCapture={(event) => {
                  // Why here: the click also reaches xterm, which takes focus by itself. Not for a
                  // header button, or removing another pane would first move the user onto it.
                  const isHeaderAction =
                    event.target instanceof Element &&
                    event.target.closest('[data-remote-grid-action]') !== null
                  if (cell && !isCurrentTab && !isHeaderAction) {
                    activateSessionTab(tab.id)
                  }
                }}
              >
                {cell ? (
                  <RemoteGridPaneHeader
                    tabId={tab.id}
                    sourceTabId={activeTerminalId ?? tab.id}
                    ptyId={tab.ptyId}
                    createdAt={tab.createdAt}
                    label={label}
                    isActive={isCurrentTab}
                    isVisible={isShown && isVisible}
                    isRunning={session.terminalStarted}
                    target={targetsById.get(session.targetId)}
                    onReconnect={onReconnect}
                    onJoinSync={onJoinSync}
                  />
                ) : null}
                <div className={cell ? 'relative min-h-0 min-w-0 flex-1' : 'absolute inset-0'}>
                  {session.terminalStarted ? (
                    <TerminalPane
                      tabId={tab.id}
                      worktreeId={SSH_SESSIONS_WORKTREE_ID}
                      cwd={cwd}
                      isActive={isCurrentTab && isShown}
                      isVisible={isShown && isVisible}
                      onPtyExit={(ptyId, exitCode) => handleTerminalExit(tab.id, ptyId, exitCode)}
                      onCloseTab={() => closeSshSession(tab.id)}
                    />
                  ) : (
                    <TerminalNotStarted
                      session={session}
                      target={targetsById.get(session.targetId)}
                      onStart={onStartTerminal}
                    />
                  )}
                </div>
              </div>
            )
          })
        : null}
      {terminalItems.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {translate('sshPage.page.pickHost', 'Pick a host to open an SSH session.')}
        </div>
      ) : null}
    </div>
  )
}
