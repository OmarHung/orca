import { isWindowVisible } from '@/lib/window-visibility-interval'
import { ORCA_TERMINAL_COMMAND_FINISHED_EVENT } from '@/hooks/terminal-command-finished-event'
import type { CoalescedPollRunnerTrigger } from '../../right-sidebar/coalesced-poll-runner'

// Why: the host's git watcher skips refs/**, so a branch, tag or fetch made by an agent or another
// app changes no watched file; only this poll notices it.
export const GIT_LOG_BACKSTOP_POLL_MS = 15_000

const CHANGE_SIGNAL: CoalescedPollRunnerTrigger = { changeSignal: true }

type GitLogRefreshSignalTarget = {
  repoId: string | null
  worktreeId: string
  onSignal: (trigger?: CoalescedPollRunnerTrigger) => void
}

function isCommandFinishedIn(event: Event, worktreeId: string): boolean {
  const detail: unknown = event instanceof CustomEvent ? event.detail : null
  return (
    typeof detail === 'object' &&
    detail !== null &&
    'worktreeId' in detail &&
    detail.worktreeId === worktreeId
  )
}

/** Reports anything that may have changed the worktree's commits or refs while Orca is visible. */
export function subscribeGitLogRefreshSignals({
  repoId,
  worktreeId,
  onSignal
}: GitLogRefreshSignalTarget): () => void {
  const signal = (trigger?: CoalescedPollRunnerTrigger): void => {
    if (isWindowVisible()) {
      onSignal(trigger)
    }
  }
  const handleRepoSignal = (data: { repoId: string }): void => {
    if (repoId !== null && data.repoId === repoId) {
      signal(CHANGE_SIGNAL)
    }
  }
  const handleCommandFinished = (event: Event): void => {
    if (isCommandFinishedIn(event, worktreeId)) {
      signal(CHANGE_SIGNAL)
    }
  }
  // Why: returning to Orca or revealing it may follow git work done elsewhere.
  const handleReturn = (): void => signal(CHANGE_SIGNAL)

  // Why: remote web clients have no preload bridge; the poll still covers them.
  const worktreesApi = window.api?.worktrees
  const unsubscribers = [
    worktreesApi?.onChanged?.(handleRepoSignal),
    worktreesApi?.onGitStatusMetadataChanged?.(handleRepoSignal)
  ].filter((unsubscribe): unsubscribe is () => void => typeof unsubscribe === 'function')
  window.addEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, handleCommandFinished)
  window.addEventListener('focus', handleReturn)
  document.addEventListener('visibilitychange', handleReturn)
  const pollId = setInterval(() => signal(), GIT_LOG_BACKSTOP_POLL_MS)

  return () => {
    clearInterval(pollId)
    document.removeEventListener('visibilitychange', handleReturn)
    window.removeEventListener('focus', handleReturn)
    window.removeEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, handleCommandFinished)
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }
}
