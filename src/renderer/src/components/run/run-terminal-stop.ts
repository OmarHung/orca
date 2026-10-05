import { CLOSE_TERMINAL_PANE_EVENT, type CloseTerminalPaneDetail } from '@/constants/terminal'
import { sendRuntimePtyInputVerified } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import {
  isRunSessionActive,
  runSessionKey,
  runStopStage,
  useRunSessionStore,
  type RunSession
} from './run-session-store'
import {
  bindingForRun,
  ensureRunTerminalListeners,
  liveRunSession,
  runInExistingTerminal,
  runInNewTerminal,
  waitForRunExit,
  waitForRunFinish,
  type RunExit
} from './run-terminal-launch'
import { prepareDotnetLauncher } from './run-dotnet-launcher'
import type { RunTarget } from './run-target'

const CTRL_C = '\x03'
/** Ctrl-\ makes the tty send SIGQUIT, which ends most programs that trap SIGINT. */
const CTRL_BACKSLASH = '\x1c'
/** How long Rerun waits for Ctrl-C to end the old run before forcing it. */
const RERUN_STOP_TIMEOUT_MS = 3_000
/** How long Rerun waits after forcing before it closes the old run terminal. */
const RERUN_FORCE_STOP_TIMEOUT_MS = 2_000
const rerunOperations = new Map<string, Promise<void>>()

/** Runs one instance per configuration, restarting an active one. */
export async function runConfiguration(target: RunTarget): Promise<void> {
  ensureRunTerminalListeners()
  // Why before reading the session: a second click during the wait must see the first launch.
  // Why only when needed: an unconditional await would delay every launch by a tick.
  const preparing = prepareDotnetLauncher(target)
  if (preparing) {
    await preparing
  }
  const session = liveRunSession(target.worktreeId, target.commandKey)
  if (!session) {
    runInNewTerminal(target)
    return
  }
  if (isRunSessionActive(session.status)) {
    await rerunConfiguration(target)
    return
  }
  if (!(await runInExistingTerminal(target, session))) {
    runInNewTerminal(target)
  }
}

function closeRunTerminal(session: RunSession): void {
  const binding = bindingForRun(session)
  if (!binding) {
    useRunSessionStore.getState().finishAttempt(session.key, session.attemptId, null)
    return
  }
  const root = useAppStore.getState().terminalLayoutsByTabId[binding.tabId]?.root
  if (!root || root.type === 'leaf') {
    useAppStore.getState().closeTab(binding.tabId)
  } else {
    const detail: CloseTerminalPaneDetail = {
      tabId: binding.tabId,
      leafId: binding.leafId,
      ...(binding.ptyId ? { expectedPtyId: binding.ptyId } : {})
    }
    window.dispatchEvent(new CustomEvent(CLOSE_TERMINAL_PANE_EVENT, { detail }))
  }
  useRunSessionStore.getState().finishAttempt(session.key, session.attemptId, null)
}

/** Advances Stop through interrupt, force, then closing only the owned terminal pane. */
export function stopConfiguration(worktreeId: string, commandKey: string): void {
  const session = liveRunSession(worktreeId, commandKey)
  if (!session || !isRunSessionActive(session.status)) {
    return
  }
  switch (runStopStage(session)) {
    case 'interrupt':
      interrupt(session)
      return
    case 'force':
      forceStop(session)
      return
    case 'close':
      closeRunTerminal(session)
  }
}

function verifyStopInput(session: RunSession, ptyId: string, input: string): void {
  void sendRuntimePtyInputVerified(useAppStore.getState().settings, ptyId, input, 'driving')
    .then((accepted) => {
      if (!accepted) {
        useRunSessionStore.getState().setStatus(session.key, session.attemptId, 'unverifiable')
      }
    })
    .catch(() => {
      useRunSessionStore.getState().setStatus(session.key, session.attemptId, 'unverifiable')
    })
}

/** Another Ctrl-C (some tools exit on the second) plus SIGQUIT; the shell ignores both. */
function forceStop(session: RunSession): void {
  const binding = bindingForRun(session)
  if (binding?.ptyId) {
    verifyStopInput(session, binding.ptyId, CTRL_C + CTRL_BACKSLASH)
  }
  useRunSessionStore.getState().markForceStopped(session.key, session.attemptId)
}

function interrupt(session: RunSession): void {
  const store = useAppStore.getState()
  const binding = bindingForRun(session)
  if (binding && session.status === 'queued' && store.pendingStartupByTabId[binding.tabId]) {
    // The shell has not received this exact pane's queued command yet.
    store.consumeTabStartupCommand(binding.tabId)
    useRunSessionStore.getState().setStatus(session.key, session.attemptId, 'stopping')
    useRunSessionStore.getState().finishAttempt(session.key, session.attemptId, null)
    return
  }
  if (binding?.ptyId) {
    verifyStopInput(session, binding.ptyId, CTRL_C)
  } else {
    useRunSessionStore.getState().setStatus(session.key, session.attemptId, 'unverifiable')
    return
  }
  useRunSessionStore.getState().setStatus(session.key, session.attemptId, 'stopping')
}

function isStillActive(session: RunSession): boolean {
  return isRunSessionActive(
    useRunSessionStore.getState().sessionsByKey[session.key]?.status ?? 'stopped'
  )
}

/** Ctrl-C, force, then close; false when the old terminal could not be reused. */
async function endRun(session: RunSession): Promise<boolean> {
  if (session.status === 'unverifiable') {
    closeRunTerminal(session)
    return false
  }
  if (session.status === 'queued' || session.status === 'running') {
    interrupt(session)
  }
  if (!isStillActive(session) || (await waitForRunFinish(session, RERUN_STOP_TIMEOUT_MS))) {
    return true
  }
  forceStop(session)
  if (await waitForRunFinish(session, RERUN_FORCE_STOP_TIMEOUT_MS)) {
    return true
  }
  closeRunTerminal(session)
  return false
}

async function rerunConfigurationOnce(target: RunTarget): Promise<void> {
  ensureRunTerminalListeners()
  const session = liveRunSession(target.worktreeId, target.commandKey)
  // Why after endRun: Rerun's Ctrl-C must not wait for the .NET launcher to be written.
  const terminalReusable = session ? await endRun(session) : false
  const preparing = prepareDotnetLauncher(target)
  if (preparing) {
    await preparing
  }
  if (!session || !terminalReusable || !(await runInExistingTerminal(target, session))) {
    runInNewTerminal(target)
  }
}

export async function rerunConfiguration(target: RunTarget): Promise<void> {
  const key = runSessionKey(target.worktreeId, target.commandKey)
  const existing = rerunOperations.get(key)
  if (existing) {
    return existing
  }
  const operation = rerunConfigurationOnce(target).finally(() => {
    if (rerunOperations.get(key) === operation) {
      rerunOperations.delete(key)
    }
  })
  rerunOperations.set(key, operation)
  return operation
}

/** Stops an active run and resolves once it has ended. */
export async function stopConfigurationAndWait(target: RunTarget): Promise<void> {
  ensureRunTerminalListeners()
  const session = liveRunSession(target.worktreeId, target.commandKey)
  if (session && isRunSessionActive(session.status)) {
    await endRun(session)
  }
}

/** Runs a configuration and waits for its command to end. */
export async function runConfigurationAndWait(target: RunTarget): Promise<RunExit> {
  await runConfiguration(target)
  const session = liveRunSession(target.worktreeId, target.commandKey)
  if (!session || !isRunSessionActive(session.status)) {
    return { status: 'stopped', exitCode: null }
  }
  return waitForRunExit(target)
}

export type { RunExit }
