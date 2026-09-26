import { useAppStore } from '@/store'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { runQuickCommandInNewTab } from '@/lib/run-quick-command-in-new-tab'
import {
  ORCA_TERMINAL_COMMAND_FINISHED_EVENT,
  type TerminalCommandFinishedEventDetail
} from '@/hooks/terminal-command-finished-event'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  flattenTerminalQuickCommand,
  isTerminalAgentQuickCommand
} from '../../../../shared/terminal-quick-commands'
import type {
  TerminalCommandQuickCommand,
  TerminalQuickCommand
} from '../../../../shared/terminal-quick-command-types'
import {
  isRunSessionActive,
  runSessionKey,
  useRunSessionStore,
  type RunSession
} from './run-session-store'

const CTRL_C = '\x03'
/** How long Rerun waits for Ctrl-C to end the old run before closing its tab. */
const RERUN_STOP_TIMEOUT_MS = 3_000

export type RunTarget = {
  worktreeId: string
  groupId: string | null
  commandKey: string
  command: TerminalCommandQuickCommand
}

/** Only shell commands are run configurations; agent prompts start agents and have no Stop/Rerun. */
export function toRunTarget(
  entry: { key: string; command: TerminalQuickCommand },
  worktreeId: string,
  groupId: string | null
): RunTarget | null {
  const { command } = entry
  if (isTerminalAgentQuickCommand(command)) {
    return null
  }
  return { worktreeId, groupId, commandKey: entry.key, command }
}

const finishWaiters = new Map<string, () => void>()
let listening = false

function handleCommandFinished(event: Event): void {
  if (!(event instanceof CustomEvent)) {
    return
  }
  const detail: Partial<TerminalCommandFinishedEventDetail> | null = event.detail
  const tabId = detail?.paneKey ? parsePaneKey(detail.paneKey)?.tabId : undefined
  if (!tabId) {
    return
  }
  useRunSessionStore.getState().finishByTab(tabId, detail?.exitCode ?? null)
  finishWaiters.get(tabId)?.()
}

/** Starts following command-finished signals; idempotent. */
export function ensureRunFinishListener(): void {
  if (listening) {
    return
  }
  listening = true
  window.addEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, handleCommandFinished)
}

function waitForFinish(tabId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finishWaiters.delete(tabId)
      resolve(false)
    }, timeoutMs)
    finishWaiters.set(tabId, () => {
      clearTimeout(timer)
      finishWaiters.delete(tabId)
      resolve(true)
    })
  })
}

function tabExists(worktreeId: string, tabId: string): boolean {
  return (useAppStore.getState().tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId)
}

function firstPtyId(tabId: string): string | null {
  return useAppStore.getState().ptyIdsByTabId[tabId]?.[0] ?? null
}

/** The session for this target if its terminal tab still exists. */
export function liveRunSession(worktreeId: string, commandKey: string): RunSession | null {
  const session = useRunSessionStore.getState().sessionsByKey[runSessionKey(worktreeId, commandKey)]
  return session && tabExists(worktreeId, session.tabId) ? session : null
}

function startSession(target: RunTarget, tabId: string): void {
  useRunSessionStore.getState().upsertSession({
    key: runSessionKey(target.worktreeId, target.commandKey),
    worktreeId: target.worktreeId,
    commandKey: target.commandKey,
    label: target.command.label,
    tabId,
    status: 'running',
    exitCode: null
  })
}

function runInNewTab(target: RunTarget): void {
  const result = runQuickCommandInNewTab({
    command: target.command,
    worktreeId: target.worktreeId,
    groupId: target.groupId,
    historyId: target.commandKey
  })
  if (result) {
    startSession(target, result.tabId)
  }
}

function focusTab(worktreeId: string, tabId: string): void {
  const store = useAppStore.getState()
  store.setActiveTab(tabId)
  store.setActiveTabType('terminal', worktreeId)
}

/** Re-sends the command into the run's existing terminal; false if that tab can't take input. */
function runInExistingTab(target: RunTarget, session: RunSession): boolean {
  const ptyId = firstPtyId(session.tabId)
  if (!ptyId) {
    return false
  }
  const text = `${flattenTerminalQuickCommand(target.command).command}\r`
  if (!sendRuntimePtyInput(useAppStore.getState().settings, ptyId, text)) {
    return false
  }
  startSession(target, session.tabId)
  focusTab(target.worktreeId, session.tabId)
  return true
}

/**
 * JetBrains-style single instance: a configuration reuses its terminal tab, and running it
 * while it is still going restarts it.
 */
export async function runConfiguration(target: RunTarget): Promise<void> {
  ensureRunFinishListener()
  const session = liveRunSession(target.worktreeId, target.commandKey)
  if (!session) {
    runInNewTab(target)
    return
  }
  if (isRunSessionActive(session.status)) {
    await rerunConfiguration(target)
    return
  }
  if (!runInExistingTab(target, session)) {
    runInNewTab(target)
  }
}

/** First press sends Ctrl-C; pressing again while it is still stopping closes the tab. */
export function stopConfiguration(worktreeId: string, commandKey: string): void {
  const session = liveRunSession(worktreeId, commandKey)
  if (!session || !isRunSessionActive(session.status)) {
    return
  }
  if (session.status === 'stopping') {
    useAppStore.getState().closeTab(session.tabId)
    useRunSessionStore.getState().finishByTab(session.tabId, null)
    return
  }
  interrupt(session)
}

function interrupt(session: RunSession): void {
  const store = useAppStore.getState()
  if (store.pendingStartupByTabId[session.tabId]) {
    // Why: the shell hasn't received the command yet, so Ctrl-C would only clear an empty
    // prompt and no finish signal would ever arrive; cancel the queued command instead.
    store.consumeTabStartupCommand(session.tabId)
    useRunSessionStore.getState().setStatus(session.key, 'stopping')
    useRunSessionStore.getState().finishByTab(session.tabId, null)
    return
  }
  const ptyId = firstPtyId(session.tabId)
  if (ptyId) {
    sendRuntimePtyInput(useAppStore.getState().settings, ptyId, CTRL_C)
  }
  useRunSessionStore.getState().setStatus(session.key, 'stopping')
}

export async function rerunConfiguration(target: RunTarget): Promise<void> {
  ensureRunFinishListener()
  const session = liveRunSession(target.worktreeId, target.commandKey)
  if (!session) {
    runInNewTab(target)
    return
  }
  if (session.status === 'running') {
    interrupt(session)
  }
  if (
    isRunSessionActive(
      useRunSessionStore.getState().sessionsByKey[session.key]?.status ?? 'stopped'
    )
  ) {
    const stopped = await waitForFinish(session.tabId, RERUN_STOP_TIMEOUT_MS)
    if (!stopped) {
      // Why: a program that ignores Ctrl-C (or a shell without OSC 133) would block forever.
      useAppStore.getState().closeTab(session.tabId)
      runInNewTab(target)
      return
    }
  }
  if (!runInExistingTab(target, session)) {
    runInNewTab(target)
  }
}
