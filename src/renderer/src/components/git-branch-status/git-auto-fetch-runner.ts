import { useAppStore } from '@/store'
import { getRepoMapFromState } from '@/store/selectors'
import { getConnectionId } from '@/lib/connection-context'
import { getSettingsForWorktreeRuntimeOwner } from '@/lib/worktree-runtime-owner'
import { resolveRemoteOperationErrorMessage } from '@/lib/source-control-remote-error'
import { fetchRuntimeGit } from '@/runtime/runtime-git-client'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { GitPushTarget } from '../../../../shared/worktree/types'
import { isGitAutoFetchDue } from './git-auto-fetch-schedule'
import { useGitAutoFetchStore } from './git-auto-fetch-store'

export type GitFetchTarget = {
  repoId: string
  worktreeId: string
  worktreePath: string
  connectionId: string | undefined
  pushTarget: GitPushTarget | undefined
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'>
}

/** The active workspace's git repository, when it can be fetched right now. */
export function resolveActiveGitFetchTarget(): GitFetchTarget | null {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const worktree = state.getKnownWorktreeById(
    worktreeId,
    state.activeWorkspaceExecutionHostId ?? undefined
  )
  const repo = worktree ? getRepoMapFromState(state).get(worktree.repoId) : undefined
  if (!worktree || !repo || !isGitRepoKind(repo)) {
    return null
  }
  const connectionId = getConnectionId(worktreeId) ?? undefined
  // Why: a reconnecting SSH host fails every fetch; wait for the link instead of recording errors.
  if (connectionId && state.sshConnectionStates.get(connectionId)?.status !== 'connected') {
    return null
  }
  return {
    repoId: repo.id,
    worktreeId,
    worktreePath: worktree.path,
    connectionId,
    pushTarget: worktree.pushTarget,
    settings: getSettingsForWorktreeRuntimeOwner(state, worktreeId)
  }
}

/** Background fetch: no toast and no busy flag; the outcome lands in the auto-fetch store. */
export async function runGitAutoFetch(target: GitFetchTarget): Promise<void> {
  const history = useGitAutoFetchStore.getState()
  if (history.runningRepoIds[target.repoId]) {
    return
  }
  history.markStarted(target.repoId, Date.now())
  const context = {
    settings: target.settings,
    worktreeId: target.worktreeId,
    worktreePath: target.worktreePath,
    connectionId: target.connectionId
  }
  try {
    await fetchRuntimeGit(context, target.pushTarget)
  } catch (error) {
    useGitAutoFetchStore
      .getState()
      .markFinished(
        target.repoId,
        Date.now(),
        resolveRemoteOperationErrorMessage(error, { isFetch: true })
      )
    return
  }
  useGitAutoFetchStore.getState().markFinished(target.repoId, Date.now(), null)
  // Why: behind counts are the reason to fetch; refresh them for the worktree on screen.
  void useAppStore
    .getState()
    .fetchUpstreamStatus(
      target.worktreeId,
      target.worktreePath,
      target.connectionId,
      target.pushTarget,
      { runtimeTargetSettings: target.settings }
    )
}

export function runGitAutoFetchTick({
  now,
  intervalMs,
  enabledAt,
  startupDelayMs
}: {
  now: number
  intervalMs: number
  enabledAt: number
  startupDelayMs: number
}): void {
  // Why: a user push/pull/fetch is in flight; racing it on the same refs can fail either side.
  if (useAppStore.getState().isRemoteOperationActive) {
    return
  }
  const target = resolveActiveGitFetchTarget()
  if (!target) {
    return
  }
  const lastAttemptAt = useGitAutoFetchStore.getState().recordsByRepo[target.repoId]?.lastAttemptAt
  if (!isGitAutoFetchDue({ now, lastAttemptAt, intervalMs, enabledAt, startupDelayMs })) {
    return
  }
  void runGitAutoFetch(target)
}
