import { FloatingWorkspaceTabDragContext } from '@/components/floating-terminal/FloatingWorkspaceTabDragContext'
import TabBar from '@/components/tab-bar/TabBar'
import TerminalPane from '@/components/terminal-pane/TerminalPane'
import { shouldDeferParkedPtyExitTabClose } from '@/components/terminal-pane/terminal-parked-tab-watchers'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isProvenProcessExit } from '../../../../shared/terminal-exit-cause'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { activateSshSession, closeSshSession, closeSshSessions } from './ssh-session-actions'
import { useSshSessionCwd } from './use-ssh-session-cwd'
import type { SshSessionItems } from './use-ssh-session-items'

type SshSessionsSurfaceProps = {
  isVisible: boolean
  items: SshSessionItems
  onNewSession: () => void
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
  onNewSession
}: SshSessionsSurfaceProps): React.JSX.Element {
  const cwd = useSshSessionCwd()
  const setTabCustomTitle = useAppStore((s) => s.setTabCustomTitle)
  const setTabColor = useAppStore((s) => s.setTabColor)
  const setTabPaneExpanded = useAppStore((s) => s.setTabPaneExpanded)
  const { terminalItems, activeTerminalId, groupTabs, tabs, parkedTerminalTabIds } = items
  const order = items.tabBarOrder.length > 0 ? items.tabBarOrder : terminalItems.map((t) => t.id)

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border">
        <FloatingWorkspaceTabDragContext enabled={isVisible} worktreeId={SSH_SESSIONS_WORKTREE_ID}>
          <TabBar
            tabs={terminalItems}
            activeTabId={activeTerminalId}
            worktreeId={SSH_SESSIONS_WORKTREE_ID}
            expandedPaneByTabId={items.expandedPaneByTabId}
            terminalOnly
            showAgentLaunchItems={false}
            activeTabType="terminal"
            tabBarOrder={items.tabBarOrder}
            onActivate={(visibleId) => activateSshSession(groupTabs, visibleId)}
            onClose={closeSshSession}
            onCloseOthers={(tabId) => closeSshSessions(order.filter((id) => id !== tabId))}
            onCloseToRight={(tabId) => closeSshSessions(tabsBeside(order, tabId, 'right'))}
            onCloseToLeft={(tabId) => closeSshSessions(tabsBeside(order, tabId, 'left'))}
            onNewTabClick={onNewSession}
            onNewTerminalTab={onNewSession}
            onNewBrowserTab={() => undefined}
            onSetCustomTitle={setTabCustomTitle}
            onSetTabColor={setTabColor}
            onTogglePaneExpand={(tabId) =>
              setTabPaneExpanded(tabId, items.expandedPaneByTabId[tabId] !== true)
            }
          />
        </FloatingWorkspaceTabDragContext>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {cwd
          ? tabs
              .filter((tab) => !parkedTerminalTabIds.has(tab.id))
              .map((tab) => {
                const isActive = tab.id === activeTerminalId
                return (
                  <div
                    key={`${tab.id}-${tab.generation ?? 0}`}
                    className={isActive ? 'absolute inset-0' : 'absolute inset-0 hidden'}
                    aria-hidden={!isActive}
                  >
                    <TerminalPane
                      tabId={tab.id}
                      worktreeId={SSH_SESSIONS_WORKTREE_ID}
                      cwd={cwd}
                      isActive={isActive}
                      isVisible={isActive && isVisible}
                      onPtyExit={(ptyId, exitCode) => {
                        if (exitCode !== undefined && !isProvenProcessExit(exitCode)) {
                          useAppStore.getState().markUnverifiedPtyLoss(tab.id)
                          return
                        }
                        if (shouldDeferParkedPtyExitTabClose(tab.id, ptyId)) {
                          return
                        }
                        closeTerminalTab(tab.id, { reason: 'pty-exit', lifecyclePtyId: ptyId })
                      }}
                      onCloseTab={() => closeSshSession(tab.id)}
                    />
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
    </div>
  )
}
