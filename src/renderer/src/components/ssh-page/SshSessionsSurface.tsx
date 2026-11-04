import { WorkspaceTabDragLayer } from '@/components/tab-group/WorkspaceTabDragLayer'
import TabBar from '@/components/tab-bar/TabBar'
import { useAppStore } from '@/store'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { activateSshSession, closeSshSession, closeSshSessions } from './ssh-session-actions'
import type { SshSessionItems } from './use-ssh-session-items'

type SshSessionsSurfaceProps = {
  isVisible: boolean
  items: SshSessionItems
  onNewSession: () => void
  /** Shown before the tabs, e.g. the host list toggle. */
  leadingControl?: React.ReactNode
  /** Shown after the tabs, e.g. the layout toggle. */
  trailingControl?: React.ReactNode
  /** Column left of the panels, under the tab strip (the host list). */
  sidePanel?: React.ReactNode
  /** The active tab's terminal and files. */
  children: React.ReactNode
}

function tabsBeside(order: readonly string[], tabId: string, side: 'left' | 'right'): string[] {
  const index = order.indexOf(tabId)
  if (index === -1) {
    return []
  }
  return side === 'left' ? order.slice(0, index) : order.slice(index + 1)
}

export function SshSessionsSurface({
  isVisible,
  items,
  onNewSession,
  leadingControl,
  trailingControl,
  sidePanel,
  children
}: SshSessionsSurfaceProps): React.JSX.Element {
  const setTabCustomTitle = useAppStore((s) => s.setTabCustomTitle)
  const setTabColor = useAppStore((s) => s.setTabColor)
  const setTabPaneExpanded = useAppStore((s) => s.setTabPaneExpanded)
  const { terminalItems, activeTerminalId, groupTabs } = items
  const order = items.tabBarOrder.length > 0 ? items.tabBarOrder : terminalItems.map((t) => t.id)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Why: this strip is the page's titlebar (the stacked one is skipped for 'ssh'), so it
          drags the window like a workspace tab row and lines up with the sidebar header. */}
      <div
        className="@container/remote-strip flex h-9 shrink-0 items-center border-b border-border bg-card"
        data-terminal-focus-release-surface="true"
      >
        {leadingControl ? (
          <div
            className="flex shrink-0 items-center pl-1"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {leadingControl}
          </div>
        ) : null}
        <WorkspaceTabDragLayer worktreeId={SSH_SESSIONS_WORKTREE_ID} enabled={isVisible}>
          {({ hoveredTabInsertion, setDragRootNode }) => (
            <div ref={setDragRootNode} className="flex h-full min-w-0 flex-1">
              <TabBar
                tabs={terminalItems}
                activeTabId={activeTerminalId}
                worktreeId={SSH_SESSIONS_WORKTREE_ID}
                expandedPaneByTabId={items.expandedPaneByTabId}
                terminalOnly
                showAgentLaunchItems={false}
                activeTabType="terminal"
                tabBarOrder={items.tabBarOrder}
                hoveredTabInsertion={hoveredTabInsertion}
                onActivate={(visibleId) => activateSshSession(groupTabs, visibleId)}
                onClose={closeSshSession}
                onCloseOthers={(tabId) => closeSshSessions(order.filter((id) => id !== tabId))}
                onCloseToRight={(tabId) => closeSshSessions(tabsBeside(order, tabId, 'right'))}
                onCloseToLeft={(tabId) => closeSshSessions(tabsBeside(order, tabId, 'left'))}
                onNewTabClick={onNewSession}
                onNewTerminalTab={onNewSession}
                onNewBrowserTab={() => undefined}
                onSetCustomTitle={(tabId, title) => {
                  // Why: rename starts from the shown label; accepting it as is must not freeze the
                  // current folder into a custom name.
                  if (title !== terminalItems.find((item) => item.id === tabId)?.title) {
                    setTabCustomTitle(tabId, title)
                  }
                }}
                onSetTabColor={setTabColor}
                onTogglePaneExpand={(tabId) =>
                  setTabPaneExpanded(tabId, items.expandedPaneByTabId[tabId] !== true)
                }
              />
            </div>
          )}
        </WorkspaceTabDragLayer>
        {trailingControl ? (
          <div className="flex shrink-0 items-center px-1.5 [-webkit-app-region:no-drag]">
            {trailingControl}
          </div>
        ) : null}
        <div className="window-controls-titlebar-spacer" />
      </div>
      <div className="flex min-h-0 flex-1">
        {sidePanel}
        {children}
      </div>
    </div>
  )
}
