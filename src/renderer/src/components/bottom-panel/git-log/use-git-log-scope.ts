import { useCallback, useEffect, useState } from 'react'
import { HEAD_GIT_LOG_SCOPE, type GitLogScope } from './git-log-scope'
import type { GitLogBranchListState } from './use-git-log-history'

/** The branch scope chosen per worktree; HEAD until the user picks one. */
export function useGitLogScope(worktreeId: string | null): {
  scope: GitLogScope
  setScope: (scope: GitLogScope) => void
} {
  const [scopeByWorktree, setScopeByWorktree] = useState<Record<string, GitLogScope>>({})
  const setScope = useCallback(
    (scope: GitLogScope): void => {
      if (worktreeId) {
        setScopeByWorktree((prev) => ({ ...prev, [worktreeId]: scope }))
      }
    },
    [worktreeId]
  )
  return {
    scope: (worktreeId ? scopeByWorktree[worktreeId] : undefined) ?? HEAD_GIT_LOG_SCOPE,
    setScope
  }
}

export function isGitLogScopeMissing(
  scope: GitLogScope,
  branchList: GitLogBranchListState
): boolean {
  return (
    scope.kind === 'ref' &&
    typeof branchList === 'object' &&
    // Why: a truncated list can't prove absence.
    !branchList.truncated &&
    !branchList.branches.some((branch) => branch.fullName === scope.fullName)
  )
}

/** A chosen branch that was deleted or pruned falls back to HEAD instead of a stuck "not found" error. */
export function useResetMissingGitLogScope(
  scope: GitLogScope,
  branchList: GitLogBranchListState,
  setScope: (scope: GitLogScope) => void
): void {
  const missing = isGitLogScopeMissing(scope, branchList)
  useEffect(() => {
    if (missing) {
      setScope(HEAD_GIT_LOG_SCOPE)
    }
  }, [missing, setScope])
}
