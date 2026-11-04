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
import {
  clearLegacySftpTabs,
  findSessionTabOnHost,
  readLegacySftpTabs,
  remoteLayoutForTab,
  remoteSessionForTab,
  useRemoteSessionStore,
  type RemoteLayout
} from './remote-session-store'
import { buildSshSessionCommand } from './ssh-session-command'
import { useSshSessionLivenessStore } from './ssh-session-liveness'
import { useSshSyncStore } from './ssh-sync-store'
import { prepareSshSessionVpn } from './ssh-session-vpn'

/** The exact ssh command for a host and the VPN it needs; null when it cannot be typed. */
export async function prepareSshCommand(
  target: SshTarget
): Promise<{ command: string; vpnName: string | null } | null> {
  // Why first: a host that cannot be typed safely must not start a VPN it will never use.
  if (!buildSshSessionCommand(target)) {
    toast.error(
      translate(
        'sshPage.session.unsafeTarget',
        'This host has characters Orca cannot pass to ssh safely. Rename it in ~/.ssh/config.'
      )
    )
    return null
  }
  const vpn = await prepareSshSessionVpn(target)
  if (vpn === 'cancelled') {
    return null
  }
  const command = buildSshSessionCommand(target, vpn?.sshOptions ?? [])
  return command ? { command, vpnName: vpn?.profileName ?? null } : null
}

/** How a dialog names where a command goes: the endpoint, and the VPN it travels through. */
export function sshConnectionDetails(target: SshTarget, vpnName: string | null): string[] {
  return [
    translate('sshPage.session.confirmTarget', 'Target: {{endpoint}}', {
      endpoint: `${target.username ? `${target.username}@` : ''}${target.host}:${target.port}`
    }),
    ...(vpnName
      ? [
          translate('sshPage.session.confirmVpn', 'Through VPN: {{name}} (already connected)', {
            name: vpnName
          })
        ]
      : [])
  ]
}

/** Asks the user to approve the exact ssh command; null when it was refused or cannot be typed. */
async function confirmSshCommand(
  target: SshTarget,
  confirm: CommandConfirm,
  note: string
): Promise<string | null> {
  const prepared = await prepareSshCommand(target)
  if (!prepared) {
    return null
  }
  const { command, vpnName } = prepared
  const isConfirmed = await confirm({
    title: translate('sshPage.session.confirmTitle', 'Connect to {{host}}?', {
      host: target.label
    }),
    details: sshConnectionDetails(target, vpnName),
    commands: [command],
    notes: [note],
    confirmLabel: translate('sshPage.session.connect', 'Connect')
  })
  return isConfirmed ? command : null
}

export function createSessionTab(label: string): string {
  const store = useAppStore.getState()
  const tab = store.createTab(
    SSH_SESSIONS_WORKTREE_ID,
    store.activeGroupIdByWorktree[SSH_SESSIONS_WORKTREE_ID],
    undefined,
    { quickCommandLabel: label }
  )
  return tab.id
}

/** After the user confirms the exact command, opens a tab that types it into a local shell. */
export async function openSshSession(target: SshTarget, confirm: CommandConfirm): Promise<void> {
  const command = await confirmSshCommand(
    target,
    confirm,
    translate(
      'sshPage.session.confirmNote',
      'Opens a new tab running your login shell and types this command into it, as if you typed it.'
    )
  )
  if (!command) {
    return
  }
  const tabId = createSessionTab(target.label)
  useRemoteSessionStore
    .getState()
    .addSession({ tabId, targetId: target.id, layout: 'terminal', terminalStarted: true })
  useAppStore.getState().queueTabStartupCommand(tabId, { command })
  focusTerminalTabSurface(tabId)
}

/** Opens a tab showing only files; nothing runs in a terminal until the user asks for one. */
export function openFilesSession(target: Pick<SshTarget, 'id' | 'label'>): string {
  const tabId = createSessionTab(target.label)
  useRemoteSessionStore
    .getState()
    .addSession({ tabId, targetId: target.id, layout: 'files', terminalStarted: false })
  return tabId
}

/** Starts ssh in a tab that has only shown files so far, once the user confirms the command. */
export async function startSessionTerminal(
  tabId: string,
  target: SshTarget,
  confirm: CommandConfirm
): Promise<void> {
  const command = await confirmSshCommand(
    target,
    confirm,
    translate(
      'sshPage.session.confirmNoteExistingTab',
      'Starts your login shell in this tab and types this command into it, as if you typed it.'
    )
  )
  // Why recheck: the tab can close while the VPN starts or the dialog waits, and ⌘W still works then.
  const store = useAppStore.getState()
  const isOpen = store.tabsByWorktree[SSH_SESSIONS_WORKTREE_ID]?.some((tab) => tab.id === tabId)
  if (!command || !isOpen) {
    return
  }
  store.queueTabStartupCommand(tabId, { command })
  useRemoteSessionStore.getState().markTerminalStarted(tabId)
  useSshSessionLivenessStore.getState().markStarting(tabId, Date.now())
  focusTerminalTabSurface(tabId)
}

/** Runs ssh again in the tab whose session ended, once the user confirms the exact command. */
export async function reconnectSessionTerminal(
  tabId: string,
  target: SshTarget,
  confirm: CommandConfirm
): Promise<void> {
  const command = await confirmSshCommand(
    target,
    confirm,
    translate(
      'sshPage.session.confirmNoteReconnect',
      'Types this command into this tab’s local shell, as if you typed it. Anything already typed at the prompt is cleared first.'
    )
  )
  if (!command) {
    return
  }
  const tabs = useAppStore.getState().tabsByWorktree[SSH_SESSIONS_WORKTREE_ID]
  const ptyId = tabs?.find((tab) => tab.id === tabId)?.ptyId
  const prompt = ptyId ? await readShellPromptState(ptyId) : 'unknown'
  if (!ptyId || prompt === 'unknown') {
    toast.error(
      translate(
        'sshPage.session.reconnectUnknown',
        'Orca can’t tell what is running in this tab, so it typed nothing.'
      )
    )
    return
  }
  if (prompt === 'busy') {
    toast.error(
      translate(
        'sshPage.session.reconnectBusy',
        'Something still seems to be running in this tab. Finish it first.'
      )
    )
    return
  }
  // Why Ctrl+C first: text left at the prompt would otherwise become part of this command line.
  const isAccepted = await window.api.pty
    .writeAccepted(ptyId, `\u0003${command}\r`, 'driving')
    .catch(() => false)
  if (!isAccepted) {
    toast.error(translate('sshPage.session.reconnectFailed', 'Couldn’t type into this tab.'))
    return
  }
  useSshSessionLivenessStore.getState().markStarting(tabId, Date.now())
  // Why: the Ctrl+C typed first cleared whatever its line held.
  useSshSyncStore.getState().markLineEmpty(tabId)
  focusTerminalTabSurface(tabId)
}

const PROMPT_EVIDENCE_RETRY_MS = 200
// Why this many: the process table is shared for up to 500ms, so a newer capture arrives well before.
const PROMPT_EVIDENCE_MAX_READS = 6

/**
 * Whether the shell itself waits at its prompt. The foreground's name can't say: a running script
 * is also called bash, and Ctrl+C would kill it. Only a capture taken after the user decided counts:
 * a shared one may predate a script started a moment ago, and would call the shell idle.
 */
async function readShellPromptState(ptyId: string): Promise<'idle' | 'busy' | 'unknown'> {
  const decidedAt = performance.now()
  for (let read = 0; read < PROMPT_EVIDENCE_MAX_READS; read += 1) {
    const inspection = await window.api.pty.inspectProcess(ptyId).catch(() => null)
    const evidence = inspection?.foregroundProcessEvidence
    if (evidence?.verdict !== 'live' || evidence.shellOwnsEveryTtyProcessGroup === undefined) {
      return 'unknown'
    }
    if (performance.now() - evidence.capturedAgeMs >= decidedAt) {
      return evidence.shellOwnsEveryTtyProcessGroup ? 'idle' : 'busy'
    }
    await new Promise((resolve) => setTimeout(resolve, PROMPT_EVIDENCE_RETRY_MS))
  }
  return 'unknown'
}

export function activateSessionTab(tabId: string): void {
  const store = useAppStore.getState()
  const tab = store.unifiedTabsByWorktree[SSH_SESSIONS_WORKTREE_ID]?.find(
    (candidate) => candidate.entityId === tabId
  )
  if (tab) {
    store.activateTab(tab.id)
    store.setActiveTab(tab.entityId)
  }
}

/** Goes to the host's tab if it has one; otherwise asks to open a new session. */
export async function showHostSession(
  target: SshTarget,
  confirm: CommandConfirm,
  strip: { orderedTabIds: readonly string[]; activeTabId: string | null }
): Promise<void> {
  const tabId = findSessionTabOnHost(
    useRemoteSessionStore.getState().sessions,
    strip.orderedTabIds,
    strip.activeTabId,
    target.id
  )
  if (!tabId) {
    await openSshSession(target, confirm)
    return
  }
  activateSessionTab(tabId)
  const { sessions, grid } = useRemoteSessionStore.getState()
  if (remoteLayoutForTab(sessions, grid, tabId) !== 'files' && sessions[tabId]?.terminalStarted) {
    focusTerminalTabSurface(tabId)
  }
}

export function setSessionLayout(tabId: string, layout: RemoteLayout): void {
  const store = useRemoteSessionStore.getState()
  store.setLayout(tabId, layout)
  if (layout !== 'files' && remoteSessionForTab(store.sessions, tabId).terminalStarted) {
    focusTerminalTabSurface(tabId)
  }
}

/** Runs once per legacy save: what the separate SFTP page had open reopens here as files tabs. */
export function migrateLegacySftpTabs(): void {
  const { tabs } = readLegacySftpTabs()
  clearLegacySftpTabs()
  const created = tabs.map((tab) => ({
    wasActive: tab.wasActive,
    tabId: openFilesSession({ id: tab.targetId, label: tab.label })
  }))
  const active = created.find((tab) => tab.wasActive)
  if (active) {
    activateSessionTab(active.tabId)
  }
}

/**
 * Tabs from before sessions only know their host by label; record the id while it still matches.
 * Why exactly one: guessing between same-named hosts would send file operations to the wrong server.
 */
export function adoptSessionlessTabs(targets: readonly SshTarget[]): void {
  const store = useRemoteSessionStore.getState()
  const tabs = useAppStore.getState().tabsByWorktree[SSH_SESSIONS_WORKTREE_ID] ?? []
  for (const tab of tabs) {
    if (store.sessions[tab.id]?.targetId) {
      continue
    }
    const matches = targets.filter((candidate) => candidate.label === tab.quickCommandLabel)
    if (matches.length === 1) {
      store.setTargetId(tab.id, matches[0].id)
    }
  }
}

export function activateSshSession(groupTabs: readonly Tab[], visibleId: string): void {
  const tab = resolveGroupTabFromVisibleId(groupTabs, visibleId)
  if (!tab) {
    return
  }
  const store = useAppStore.getState()
  store.activateTab(tab.id)
  store.setActiveTab(tab.entityId)
  const { sessions, grid } = useRemoteSessionStore.getState()
  const session = remoteSessionForTab(sessions, tab.entityId)
  if (remoteLayoutForTab(sessions, grid, tab.entityId) !== 'files' && session.terminalStarted) {
    focusTerminalTabSurface(tab.entityId)
  }
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
