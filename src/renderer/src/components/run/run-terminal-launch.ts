import { useAppStore } from '@/store'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  ORCA_TERMINAL_COMMAND_FINISHED_EVENT,
  type TerminalCommandFinishedEventDetail
} from '@/hooks/terminal-command-finished-event'
import {
  ORCA_TERMINAL_STARTUP_BOUND_EVENT,
  type TerminalStartupBoundEventDetail
} from '@/hooks/terminal-startup-bound-event'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { flattenTerminalQuickCommand } from '../../../../shared/terminal-quick-commands'
import { openRunTerminal } from './run-terminal-open'
import { revealRunInPanel } from './run-panel-store'
import { runSessionKey, useRunSessionStore, type RunSession } from './run-session-store'
import { resolveRunTerminalBinding, type RunTerminalBinding } from './run-terminal-binding'
import type { RunTarget } from './run-target'

/** How often a waited-on run checks that its pane still exists. */
const RUN_PANE_POLL_MS = 1_000
const finishWaiters = new Map<string, () => void>()
let listening = false

function attemptKey(session: Pick<RunSession, 'key' | 'attemptId'>): string {
  return `${session.key}\u0000${session.attemptId}`
}

function handleCommandFinished(event: Event): void {
  if (!(event instanceof CustomEvent)) {
    return
  }
  const detail: Partial<TerminalCommandFinishedEventDetail> | null = event.detail
  const pane = detail?.paneKey ? parsePaneKey(detail.paneKey) : null
  if (!pane) {
    return
  }
  const finished = useRunSessionStore
    .getState()
    .finishByLeafId(pane.leafId, detail?.exitCode ?? null)
  if (finished) {
    finishWaiters.get(attemptKey(finished))?.()
  }
}

function handleStartupBound(event: Event): void {
  if (!(event instanceof CustomEvent)) {
    return
  }
  const detail: Partial<TerminalStartupBoundEventDetail> | null = event.detail
  const pane = detail?.paneKey ? parsePaneKey(detail.paneKey) : null
  if (pane) {
    useRunSessionStore.getState().markRunningByLeafId(pane.leafId)
  }
}

/** Starts following terminal lifecycle signals; idempotent. */
export function ensureRunTerminalListeners(): void {
  if (listening) {
    return
  }
  listening = true
  window.addEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, handleCommandFinished)
  window.addEventListener(ORCA_TERMINAL_STARTUP_BOUND_EVENT, handleStartupBound)
}

export function waitForRunFinish(session: RunSession, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const key = attemptKey(session)
    const timer = setTimeout(() => {
      finishWaiters.delete(key)
      resolve(false)
    }, timeoutMs)
    finishWaiters.set(key, () => {
      clearTimeout(timer)
      finishWaiters.delete(key)
      resolve(true)
    })
  })
}

export function bindingForRun(session: RunSession): RunTerminalBinding | null {
  const binding = resolveRunTerminalBinding(
    useAppStore.getState(),
    session.worktreeId,
    session.leafId
  )
  if (binding && binding.tabId !== session.tabId) {
    useRunSessionStore.getState().setTabId(session.key, session.attemptId, binding.tabId)
  }
  return binding
}

/** The session for this target if its stable terminal pane still exists. */
export function liveRunSession(worktreeId: string, commandKey: string): RunSession | null {
  const session = useRunSessionStore.getState().sessionsByKey[runSessionKey(worktreeId, commandKey)]
  if (!session) {
    return null
  }
  const binding = bindingForRun(session)
  return binding ? { ...session, tabId: binding.tabId } : null
}

function startSession(
  target: RunTarget,
  binding: Pick<RunTerminalBinding, 'tabId' | 'leafId'>,
  status: 'queued' | 'running'
): void {
  const key = runSessionKey(target.worktreeId, target.commandKey)
  const liveTabIds = new Set(
    (useAppStore.getState().tabsByWorktree[target.worktreeId] ?? []).map((tab) => tab.id)
  )
  const sessions = useRunSessionStore.getState()
  // Why here: a launch is when this workspace's tabs are surely loaded, so stored runs whose
  // terminal was closed elsewhere can be dropped without guessing during startup.
  sessions.retainSessions(
    (session) =>
      session.worktreeId !== target.worktreeId ||
      session.key === key ||
      liveTabIds.has(session.tabId)
  )
  sessions.upsertSession({
    key,
    worktreeId: target.worktreeId,
    commandKey: target.commandKey,
    label: target.command.label,
    tabId: binding.tabId,
    leafId: binding.leafId,
    attemptId: createBrowserUuid(),
    status,
    exitCode: null,
    // Why no group: tab groups are per session; a rerun keeps the run's own terminal.
    target: { ...target, groupId: null }
  })
}

/** Starts the run in a terminal the Run panel owns; it never joins the tab strip. */
export function runInNewTerminal(target: RunTarget): void {
  const opened = openRunTerminal(target, (ids) => startSession(target, ids, 'queued'))
  if (!opened) {
    return
  }
  // The store mints another tab id when the hinted one is taken.
  const session =
    useRunSessionStore.getState().sessionsByKey[runSessionKey(target.worktreeId, target.commandKey)]
  if (session?.tabId !== opened.tabId) {
    startSession(target, opened, 'queued')
  }
  revealRunInPanel(target.worktreeId, target.commandKey)
}

/** Re-sends the command into the run's existing pane when its PTY accepts input. */
export async function runInExistingTerminal(
  target: RunTarget,
  session: RunSession
): Promise<boolean> {
  const binding = bindingForRun(session)
  if (!binding?.ptyId) {
    return false
  }
  const text = `${flattenTerminalQuickCommand(target.command).command}\r`
  try {
    if (
      !(await sendRuntimePtyInputVerified(useAppStore.getState().settings, binding.ptyId, text))
    ) {
      return false
    }
  } catch {
    return false
  }
  startSession(target, binding, 'running')
  revealRunInPanel(target.worktreeId, target.commandKey)
  return true
}

export type RunExit = {
  status: 'succeeded' | 'failed' | 'finished' | 'stopped'
  exitCode: number | null
}

function runExitFor(session: RunSession): RunExit | null {
  const { status } = session
  switch (status) {
    case 'queued':
    case 'running':
    case 'stopping':
    case 'unverifiable':
      return null
    case 'succeeded':
    case 'failed':
    case 'finished':
    case 'stopped':
      return { status, exitCode: session.exitCode }
  }
}

/** Resolves when the run ends, is stopped, or loses its pane. */
export function waitForRunExit(target: RunTarget): Promise<RunExit> {
  const key = runSessionKey(target.worktreeId, target.commandKey)
  const stopped: RunExit = { status: 'stopped', exitCode: null }
  return new Promise((resolve) => {
    let unsubscribe = (): void => {}
    let timer: ReturnType<typeof setInterval> | undefined
    const settle = (exit: RunExit): void => {
      unsubscribe()
      clearInterval(timer)
      resolve(exit)
    }
    const check = (): void => {
      const session = useRunSessionStore.getState().sessionsByKey[key]
      if (!session || !bindingForRun(session)) {
        settle(stopped)
        return
      }
      const exit = runExitFor(session)
      if (exit) {
        settle(exit)
      }
    }
    unsubscribe = useRunSessionStore.subscribe(check)
    timer = setInterval(check, RUN_PANE_POLL_MS)
    check()
  })
}
