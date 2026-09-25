export type GitHistoryGraphColorId =
  | 'git-graph-ref'
  | 'git-graph-remote-ref'
  | 'git-graph-base-ref'
  | 'git-graph-lane-1'
  | 'git-graph-lane-2'
  | 'git-graph-lane-3'
  | 'git-graph-lane-4'
  | 'git-graph-lane-5'

export const GIT_HISTORY_REF_COLOR: GitHistoryGraphColorId = 'git-graph-ref'
export const GIT_HISTORY_REMOTE_REF_COLOR: GitHistoryGraphColorId = 'git-graph-remote-ref'
export const GIT_HISTORY_BASE_REF_COLOR: GitHistoryGraphColorId = 'git-graph-base-ref'

export const GIT_HISTORY_LANE_COLORS: readonly GitHistoryGraphColorId[] = [
  'git-graph-lane-1',
  'git-graph-lane-2',
  'git-graph-lane-3',
  'git-graph-lane-4',
  'git-graph-lane-5'
]

export const GIT_HISTORY_DEFAULT_LIMIT = 50
export const GIT_HISTORY_MAX_LIMIT = 200

export type GitHistoryRefCategory = 'branches' | 'remote branches' | 'tags' | 'commits'

export type GitHistoryItemRef = {
  id: string
  name: string
  revision?: string
  category?: GitHistoryRefCategory
  description?: string
  color?: GitHistoryGraphColorId
}

export type GitHistoryItemStatistics = {
  files: number
  insertions: number
  deletions: number
}

export type GitHistoryItem = {
  id: string
  parentIds: string[]
  subject: string
  message: string
  displayId?: string
  author?: string
  authorEmail?: string
  /** Epoch milliseconds (git %at seconds × 1000). */
  timestamp?: number
  statistics?: GitHistoryItemStatistics
  references?: GitHistoryItemRef[]
}

export type GitHistoryOptions = {
  limit?: number
  baseRef?: string | null
  /** Full ref name (`refs/heads/…` or `refs/remotes/…`) to log instead of HEAD. */
  revision?: string | null
  /** Log every local and remote branch plus HEAD; wins over `revision`. */
  allBranches?: boolean
  /** Also return the repository's branch list in `refs`. */
  includeRefs?: boolean
}

/** Which commits the host actually logged. Absent = a host that predates revision support (HEAD only). */
export type GitHistoryRevisionScope = 'head' | 'ref' | 'all'

export type GitHistoryBranchKind = 'local' | 'remote'

export type GitHistoryBranch = {
  /** Full ref name, e.g. `refs/heads/main` or `refs/remotes/origin/main`. */
  fullName: string
  /** Short display name, e.g. `main` or `origin/main`. */
  name: string
  kind: GitHistoryBranchKind
  revision: string
  isHead: boolean
  /** Short upstream name for local branches, e.g. `origin/main`. */
  upstream?: string
}

export type GitHistoryBranchList = {
  branches: GitHistoryBranch[]
  /** More branches exist than were returned. */
  truncated: boolean
}

export type GitHistoryResult = {
  items: GitHistoryItem[]
  currentRef?: GitHistoryItemRef
  remoteRef?: GitHistoryItemRef
  baseRef?: GitHistoryItemRef
  mergeBase?: string
  hasIncomingChanges: boolean
  hasOutgoingChanges: boolean
  hasMore: boolean
  limit: number
  revisionScope?: GitHistoryRevisionScope
  /** Present only when `includeRefs` was requested and the host supports it. */
  refs?: GitHistoryBranchList
}

export type GitHistoryExecutor = (
  args: string[],
  cwd: string
) => Promise<{ stdout: string; stderr?: string }>
