import { useEffect } from 'react'
import { createCoalescedPollRunner } from '../../right-sidebar/coalesced-poll-runner'
import { subscribeGitLogRefreshSignals } from './git-log-refresh-signals'

// Why: one git operation fires several signals (index, ref, command end); space the reloads out.
const GIT_LOG_MIN_REFRESH_GAP_MS = 1_000

/** Reloads the log (via a stable `reload`) whenever a git operation may have changed it. */
export function useGitLogAutoRefresh({
  repoId,
  worktreeId,
  enabled,
  reload
}: {
  repoId: string | null
  worktreeId: string | null
  enabled: boolean
  reload: () => Promise<void>
}): void {
  useEffect(() => {
    if (!enabled || !worktreeId) {
      return
    }
    const runner = createCoalescedPollRunner(reload, { minIntervalMs: GIT_LOG_MIN_REFRESH_GAP_MS })
    const unsubscribe = subscribeGitLogRefreshSignals({
      repoId,
      worktreeId,
      onSignal: runner.run
    })
    return () => {
      unsubscribe()
      runner.dispose()
    }
  }, [enabled, reload, repoId, worktreeId])
}
