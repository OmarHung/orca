import type { GitHistoryOptions, GitHistoryResult } from '../../../../../shared/git-history'

/** Which commits the Git Log shows: the checked-out branch, one chosen branch, or every branch. */
export type GitLogScope = { kind: 'head' } | { kind: 'all' } | { kind: 'ref'; fullName: string }

export const HEAD_GIT_LOG_SCOPE: GitLogScope = { kind: 'head' }
export const ALL_GIT_LOG_SCOPE: GitLogScope = { kind: 'all' }

export function gitLogScopeKey(scope: GitLogScope): string {
  return scope.kind === 'ref' ? `ref:${scope.fullName}` : scope.kind
}

export function gitLogScopeToHistoryOptions(
  scope: GitLogScope
): Pick<GitHistoryOptions, 'revision' | 'allBranches'> {
  if (scope.kind === 'all') {
    return { allBranches: true }
  }
  return scope.kind === 'ref' ? { revision: scope.fullName } : {}
}

/**
 * False when the host ignored the requested scope — an older host drops the unknown option and
 * logs HEAD without saying so (no `revisionScope`), which must not be shown as the chosen branch.
 */
export function isGitLogScopeHonored(scope: GitLogScope, result: GitHistoryResult): boolean {
  if (scope.kind === 'head') {
    return true
  }
  return result.revisionScope === scope.kind
}
