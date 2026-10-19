import { inspectRuntimeTerminalProcess } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import { verifyRestoredRun } from './run-restore-verdict'
import { isRunSessionActive, useRunSessionStore } from './run-session-store'
import { resolveRunTerminalBinding } from './run-terminal-binding'

let installed = false

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Stops restored runs whose terminal came back without their command, as after a reboot. */
export function ensureRestoredRunVerification(): void {
  if (installed) {
    return
  }
  installed = true
  // Why only runs restored from storage: a run launched in this window follows the shell's marks.
  const pending = new Map(
    Object.values(useRunSessionStore.getState().sessionsByKey)
      .filter((session) => isRunSessionActive(session.status))
      .map((session) => [session.attemptId, session.key] as const)
  )
  const check = (): void => {
    for (const [attemptId, key] of pending) {
      const session = useRunSessionStore.getState().sessionsByKey[key]
      if (session?.attemptId !== attemptId || !isRunSessionActive(session.status)) {
        pending.delete(attemptId)
        continue
      }
      // Why a bound PTY: hydration clears pty ids, so one here was attached in this window.
      const ptyId = resolveRunTerminalBinding(
        useAppStore.getState(),
        session.worktreeId,
        session.leafId
      )?.ptyId
      if (!ptyId) {
        continue
      }
      pending.delete(attemptId)
      void verifyRestoredRun(() => inspectRuntimeTerminalProcess(ptyId), wait).then((verdict) => {
        if (verdict === 'ended') {
          useRunSessionStore.getState().stopAttempt(key, attemptId)
        }
      })
    }
    if (pending.size === 0) {
      unsubscribe()
    }
  }
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.ptyIdsByTabId !== previous.ptyIdsByTabId) {
      check()
    }
  })
  check()
}
