import { useCallback, useEffect, useRef, useState } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeGitHistory } from '@/runtime/runtime-git-client'
import { translate } from '@/i18n/i18n'
import { GIT_HISTORY_MAX_LIMIT, type GitHistoryBranchList } from '../../../../../shared/git-history'
import type { GitHistoryPanelState } from '../../right-sidebar/source-control/sync/git-history-panel'
import { gitLogScopeKey, gitLogScopeToHistoryOptions, type GitLogScope } from './git-log-scope'
import type { GitLogWorktree } from './use-git-log-worktree'

const IDLE_STATE: GitHistoryPanelState = { status: 'idle' }

/** `unsupported` = the host answered without a branch list, i.e. it predates branch support. */
export type GitLogBranchListState = GitHistoryBranchList | 'unsupported' | undefined

type GitLogHistory = {
  state: GitHistoryPanelState
  branchList: GitLogBranchListState
  refresh: () => Promise<void>
}

/**
 * Loads the active worktree's commit log for `scope` while the Git Log is visible. Results are
 * kept per worktree + scope so switching back restores instantly; the branch list is kept per
 * worktree so the tree doesn't blank while a newly chosen branch loads.
 */
export function useGitLogHistory(
  worktree: GitLogWorktree,
  scope: GitLogScope,
  isVisible: boolean
): GitLogHistory {
  const { worktreeId, worktreePath, isFolder, repoSettings, observedHead } = worktree
  const [stateByKey, setStateByKey] = useState<Record<string, GitHistoryPanelState>>({})
  const [branchListByWorktree, setBranchListByWorktree] = useState<
    Record<string, GitLogBranchListState>
  >({})
  const requestSeqRef = useRef(0)
  const latestRequestByKeyRef = useRef<Record<string, number>>({})
  // Why: reads route by owner host; a new settings object with the same host must not refetch.
  // `scope` must be referentially stable (held in state); the load effect keys on scopeKey.
  const ownerHostKey = repoSettings?.activeRuntimeEnvironmentId?.trim() ?? ''
  const scopeKey = gitLogScopeKey(scope)
  const stateKey = worktreeId ? `${worktreeId}\n${scopeKey}` : null

  const refresh = useCallback(async (): Promise<void> => {
    if (!worktreeId || !worktreePath || !stateKey || isFolder || !isVisible) {
      return
    }
    const requestId = ++requestSeqRef.current
    latestRequestByKeyRef.current[stateKey] = requestId
    setStateByKey((prev) => {
      const previous = prev[stateKey]
      return {
        ...prev,
        [stateKey]: previous?.result
          ? { status: 'refreshing', result: previous.result }
          : { status: 'loading' }
      }
    })
    try {
      const result = await getRuntimeGitHistory(
        {
          settings: repoSettings,
          worktreeId,
          worktreePath,
          connectionId: getConnectionId(worktreeId) ?? undefined
        },
        {
          limit: GIT_HISTORY_MAX_LIMIT,
          baseRef: null,
          includeRefs: true,
          ...gitLogScopeToHistoryOptions(scope)
        }
      )
      if (latestRequestByKeyRef.current[stateKey] !== requestId) {
        return
      }
      setStateByKey((prev) => ({ ...prev, [stateKey]: { status: 'ready', result } }))
      setBranchListByWorktree((prev) => ({
        ...prev,
        [worktreeId]: result.refs ?? 'unsupported'
      }))
    } catch (error) {
      if (latestRequestByKeyRef.current[stateKey] !== requestId) {
        return
      }
      const message =
        error instanceof Error
          ? error.message
          : translate('bottomPanel.gitLog.loadFailed', 'Failed to load commits')
      setStateByKey((prev) => {
        const previous = prev[stateKey]
        return {
          ...prev,
          [stateKey]: previous?.result
            ? { status: 'error', result: previous.result, error: message }
            : { status: 'error', error: message }
        }
      })
    }
  }, [isFolder, isVisible, repoSettings, scope, stateKey, worktreeId, worktreePath])

  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    if (!isVisible) {
      return
    }
    void refreshRef.current()
    // Why: observedHead re-runs the load after commits/checkouts made anywhere (terminal, agents).
  }, [isVisible, isFolder, observedHead, ownerHostKey, scopeKey, worktreeId, worktreePath])

  return {
    state: stateKey ? (stateByKey[stateKey] ?? IDLE_STATE) : IDLE_STATE,
    branchList: worktreeId ? branchListByWorktree[worktreeId] : undefined,
    refresh
  }
}
