import { toast } from 'sonner'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { Tab } from '../../../../shared/tab-types'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import type { CommandConfirm } from '../command-confirm/command-confirm-context'
import { buildSshSessionCommand } from './ssh-session-command'
import { prepareSshSessionVpn } from './ssh-session-vpn'

/** After the user confirms the exact command, opens an SSH page tab that types it into a local shell. */
export async function openSshSession(target: SshTarget, confirm: CommandConfirm): Promise<void> {
  // Why first: a host that cannot be typed safely must not start a VPN it will never use.
  if (!buildSshSessionCommand(target)) {
    toast.error(
      translate(
        'sshPage.session.unsafeTarget',
        'This host has characters Orca cannot pass to ssh safely. Rename it in ~/.ssh/config.'
      )
    )
    return
  }
  const vpn = await prepareSshSessionVpn(target)
  if (vpn === 'cancelled') {
    return
  }
  const command = buildSshSessionCommand(target, vpn ? [vpn.sshOption] : [])
  if (!command) {
    return
  }
  const isConfirmed = await confirm({
    title: translate('sshPage.session.confirmTitle', 'Connect to {{host}}?', {
      host: target.label
    }),
    details: [
      translate('sshPage.session.confirmTarget', 'Target: {{endpoint}}', {
        endpoint: `${target.username ? `${target.username}@` : ''}${target.host}:${target.port}`
      }),
      ...(vpn
        ? [
            translate('sshPage.session.confirmVpn', 'Through VPN: {{name}} (already connected)', {
              name: vpn.profileName
            })
          ]
        : [])
    ],
    commands: [command],
    notes: [
      translate(
        'sshPage.session.confirmNote',
        'Opens a new tab running your login shell and types this command into it, as if you typed it.'
      )
    ],
    confirmLabel: translate('sshPage.session.connect', 'Connect')
  })
  if (!isConfirmed) {
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
