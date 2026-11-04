import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { useAppStore } from '@/store'
import { SSH_SESSIONS_WORKTREE_ID } from '../../../../shared/local-synthetic-workspace'
import type { SshCommandBuiltins } from '../../../../shared/ssh-command-template'
import type { SshRemotePlatform, SshTarget } from '../../../../shared/ssh-types'
import {
  remoteLayoutForTab,
  remoteSessionForTab,
  useRemoteSessionStore
} from '../ssh-page/remote-session-store'
import { setSessionLayout } from '../ssh-page/ssh-session-actions'
import { isSshProcess, useSshSessionLivenessStore } from '../ssh-page/ssh-session-liveness'
import { readTerminalTabScreen } from '../terminal-pane/terminal-pane-manager-registry'

export type SshCommandBlockReason =
  | 'notConnected'
  | 'localShell'
  | 'unknown'
  | 'fullScreen'
  | 'splitTab'

/** Why a tab can be typed into, yet might not be on the host it was opened for. */
export type SshCommandDoubt = 'noSshEvidence' | 'manualSsh'

export type SshCommandTargetCheck =
  | { kind: 'ready'; ptyId: string; doubt: SshCommandDoubt | null }
  | { kind: 'blocked'; reason: SshCommandBlockReason }

/**
 * Whether text typed into this tab would reach the remote shell. Text sent anywhere else runs on
 * the user's own computer, or lands in a full-screen program as its own keystrokes.
 */
export async function checkSshCommandTarget(tabId: string): Promise<SshCommandTargetCheck> {
  const tabs = useAppStore.getState().tabsByWorktree[SSH_SESSIONS_WORKTREE_ID]
  const ptyId = tabs?.find((tab) => tab.id === tabId)?.ptyId
  const session = remoteSessionForTab(useRemoteSessionStore.getState().sessions, tabId)
  if (!ptyId || !session.terminalStarted) {
    return { kind: 'blocked', reason: 'notConnected' }
  }
  const screen = readTerminalTabScreen(tabId)
  if (!screen) {
    return { kind: 'blocked', reason: 'unknown' }
  }
  if (screen.paneCount > 1) {
    return { kind: 'blocked', reason: 'splitTab' }
  }
  if (screen.isFullScreen) {
    return { kind: 'blocked', reason: 'fullScreen' }
  }
  const foreground = await window.api.pty.getForegroundProcess(ptyId).catch(() => null)
  if (foreground !== null && isSshProcess(foreground)) {
    const isManual = useSshSessionLivenessStore.getState().byTab[tabId]?.hasManualSsh === true
    return { kind: 'ready', ptyId, doubt: isManual ? 'manualSsh' : null }
  }
  // Why: Windows reports the shell even while ssh runs under it, so it can't prove either way.
  if (getShortcutPlatform() === 'win32') {
    return { kind: 'ready', ptyId, doubt: 'noSshEvidence' }
  }
  return { kind: 'blocked', reason: foreground === null ? 'unknown' : 'localShell' }
}

export function sshCommandBlockMessage(reason: SshCommandBlockReason): string {
  switch (reason) {
    case 'notConnected':
      return translate('sshCommands.blocked.notConnected', 'Connect this tab’s terminal first.')
    case 'localShell':
      return translate(
        'sshCommands.blocked.localShell',
        'This tab is back on your computer, so the command would run here. Reconnect first.'
      )
    case 'unknown':
      return translate(
        'sshCommands.blocked.unknown',
        'Orca can’t tell whether this tab is connected, so it sent nothing.'
      )
    case 'fullScreen':
      return translate(
        'sshCommands.blocked.fullScreen',
        'A full-screen program is open in this tab and would read the text as keystrokes. Close it first.'
      )
    case 'splitTab':
      return translate(
        'sshCommands.blocked.splitTab',
        'This tab is split, so Orca can’t tell which pane should get the command.'
      )
  }
}

/** Values a template fills in by itself, read fresh since files can change behind the dialog. */
export function sshCommandBuiltins(tabId: string, target: SshTarget): SshCommandBuiltins {
  const { remotePathByTab, remoteSelectionByTab } = useRemoteSessionStore.getState()
  return {
    host: target.host,
    user: target.username,
    path: remotePathByTab[tabId] ?? null,
    selected: remoteSelectionByTab[tabId] ?? []
  }
}

/**
 * Whether the host is known to be Windows, whose shells quote differently. Only a relay reports it,
 * and this page has none, so a folder like `/C:/Users` counts too. Unknown means POSIX.
 */
export function sshCommandRemotePlatform(
  tabId: string,
  targetId: string
): SshRemotePlatform | undefined {
  const reported = useAppStore.getState().sshConnectionStates.get(targetId)?.remotePlatform
  if (reported) {
    return reported
  }
  const path = useRemoteSessionStore.getState().remotePathByTab[tabId]
  return path && /^\/?[A-Za-z]:[\\/]/.test(path) ? 'win32' : undefined
}

/** Checks again right before typing: the dialog can stay open while ssh ends behind it. */
export async function typeSshCommand(
  tabId: string,
  command: string,
  mode: 'run' | 'insert'
): Promise<{ isSent: true } | { isSent: false; reason: string }> {
  const check = await checkSshCommandTarget(tabId)
  if (check.kind === 'blocked') {
    return { isSent: false, reason: sshCommandBlockMessage(check.reason) }
  }
  const isAccepted = await window.api.pty
    .writeAccepted(check.ptyId, mode === 'run' ? `${command}\r` : command, 'driving')
    .catch(() => false)
  if (!isAccepted) {
    return {
      isSent: false,
      reason: translate('sshCommands.sendFailed', 'Couldn’t type into this tab.')
    }
  }
  // Why: the command's output is the point, and a files-only layout would hide it.
  const { sessions, grid } = useRemoteSessionStore.getState()
  if (remoteLayoutForTab(sessions, grid, tabId) === 'files') {
    setSessionLayout(tabId, 'split')
  }
  return { isSent: true }
}

/** Types into one tab and leaves the keyboard there, or says why it couldn't. */
export async function sendSshCommand(
  tabId: string,
  command: string,
  mode: 'run' | 'insert'
): Promise<boolean> {
  const result = await typeSshCommand(tabId, command, mode)
  if (!result.isSent) {
    toast.error(result.reason)
    return false
  }
  focusTerminalTabSurface(tabId)
  return true
}
