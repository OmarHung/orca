import type { GitStatusEntry, GitUpstreamStatus } from '../../../../shared/git-status-types'

const SHORT_SHA_LENGTH = 7

export type BranchStatusSummary = {
  /** Branch name, or the short HEAD sha when detached. */
  label: string
  isDetached: boolean
  hasUpstream: boolean
  upstreamName: string | null
  ahead: number
  behind: number
  /** Distinct paths with uncommitted changes (a file staged and edited again counts once). */
  changedFileCount: number
  conflictCount: number
  /** True when git stopped listing changes at its entry cap, so the count is a floor. */
  changedFileCountIsPartial: boolean
}

export function branchDisplayName(branch: string | null | undefined): string | null {
  const trimmed = branch?.trim()
  if (!trimmed) {
    return null
  }
  return trimmed.startsWith('refs/heads/') ? trimmed.slice('refs/heads/'.length) : trimmed
}

function countDistinctPaths(entries: readonly GitStatusEntry[]): number {
  return new Set(entries.filter((entry) => !entry.submoduleRoot).map((entry) => entry.path)).size
}

function countConflicts(entries: readonly GitStatusEntry[]): number {
  return new Set(
    entries.filter((entry) => entry.conflictStatus === 'unresolved').map((entry) => entry.path)
  ).size
}

/**
 * What the status-bar branch segment shows for one worktree, or null when
 * there is no branch or HEAD to name yet.
 */
export function summarizeBranchStatus({
  branch,
  head,
  entries,
  entriesArePartial,
  upstream
}: {
  branch: string | null | undefined
  head: string | null | undefined
  entries: readonly GitStatusEntry[] | undefined
  entriesArePartial: boolean
  upstream: GitUpstreamStatus | undefined
}): BranchStatusSummary | null {
  const branchName = branchDisplayName(branch)
  const label = branchName ?? (head ? head.slice(0, SHORT_SHA_LENGTH) : null)
  if (!label) {
    return null
  }
  return {
    label,
    isDetached: branchName === null,
    hasUpstream: upstream?.hasUpstream === true,
    upstreamName: upstream?.upstreamName ?? null,
    ahead: upstream?.ahead ?? 0,
    behind: upstream?.behind ?? 0,
    changedFileCount: countDistinctPaths(entries ?? []),
    conflictCount: countConflicts(entries ?? []),
    changedFileCountIsPartial: entriesArePartial
  }
}
