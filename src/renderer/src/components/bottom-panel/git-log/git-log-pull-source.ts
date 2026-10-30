import type { GitLogBranchListState } from './use-git-log-history'

/** What the toolbar Pull brings into the checked-out branch. */
export type GitLogPullSource = {
  /** Full remote-tracking ref, e.g. `refs/remotes/origin/main`. */
  ref: string
  /** Short upstream name, e.g. `origin/main`. */
  upstream: string
  behind: number
}

/** The checked-out branch's remote-tracking upstream; null when there is nothing to pull from. */
export function resolveGitLogPullSource(
  branchList: GitLogBranchListState
): GitLogPullSource | null {
  if (typeof branchList !== 'object') {
    return null
  }
  const head = branchList.branches.find((branch) => branch.isHead && branch.kind === 'local')
  if (!head?.upstream || head.upstreamGone) {
    return null
  }
  const upstream = head.upstream
  const tracking = branchList.branches.find(
    (branch) => branch.kind === 'remote' && branch.name === upstream
  )
  // Why: a cut-short list can omit the remote ref; a missing one otherwise means a local upstream.
  const ref = tracking?.fullName ?? (branchList.truncated ? `refs/remotes/${upstream}` : null)
  return ref ? { ref, upstream, behind: head.behind ?? 0 } : null
}
