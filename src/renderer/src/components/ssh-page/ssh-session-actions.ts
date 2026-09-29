import { toast } from 'sonner'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { Tab } from '../../../../shared/tab-types'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import { buildSshSessionCommand } from './ssh-session-command'

/** Opens a new SSH page tab that runs `ssh <alias>` in a local shell. */
export function openSshSession(target: SshTarget): void {
  const command = buildSshSessionCommand(target)
  if (!command) {
    toast.error(
      translate(
        'sshPage.session.unsafeTarget',
        'This host has characters Orca cannot pass to ssh safely. Rename it in ~/.ssh/config.'
      )
    )
    return
  }
  const store = useAppStore.getState()
  const tab = store.createTab(
    SSH_SESSIONS_WORKTREE_ID,
    store.activeGroupIdByWorktree[SSH_SESSIONS_WORKTREE_ID],
    undefined,
    { quickCommandLabel: target.label }
  )
  store.queueTabStartupCommand(tab.id, { command })
  focusTerminalTabSurface(tab.id)
}

export function activateSshSession(groupTabs: readonly Tab[], visibleId: string): void {
  const tab = resolveGroupTabFromVisibleId(groupTabs, visibleId)
  if (!tab) {
    return
  }
  const store = useAppStore.getState()
  store.activateTab(tab.id)
  store.setActiveTab(tab.entityId)
  focusTerminalTabSurface(tab.entityId)
}

export function closeSshSession(terminalTabId: string): void {
  closeTerminalTab(terminalTabId)
}

/** Bulk close from the tab context menu; like the floating panel, it skips per-tab prompts. */
export function closeSshSessions(terminalTabIds: readonly string[]): void {
  const { closeTab } = useAppStore.getState()
  for (const tabId of terminalTabIds) {
    closeTab(tabId, { reason: 'cleanup' })
  }
}
