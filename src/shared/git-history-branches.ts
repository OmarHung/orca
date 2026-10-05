import type {
  GitHistoryBranch,
  GitHistoryBranchList,
  GitHistoryExecutor
} from './git-history-types'

/** Cap so a repo with thousands of remote branches cannot flood the wire or the tree. */
export const GIT_HISTORY_BRANCH_LIMIT = 1000

const LOCAL_PREFIX = 'refs/heads/'
const REMOTE_PREFIX = 'refs/remotes/'
// Why these atoms: %(HEAD), %(upstream:short) and %(upstream:track,nobracket) (2.13) all predate
// the Git 2.25 baseline. Older Orca clients ignore the extra field.
const BRANCH_FORMAT =
  '%(refname)%00%(objectname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track,nobracket)'
const TRACK_COUNT_PATTERN = /\b(ahead|behind) (\d+)/g

type GitHistoryBranchTracking = Pick<GitHistoryBranch, 'ahead' | 'behind' | 'upstreamGone'>

/** Reads `ahead 2, behind 1`, `ahead 2`, `gone` or an empty (in sync) track field. */
export function parseGitHistoryBranchTrack(track: string | undefined): GitHistoryBranchTracking {
  const value = track?.trim() ?? ''
  if (value === 'gone') {
    return { upstreamGone: true }
  }
  const tracking: GitHistoryBranchTracking = {}
  for (const [, direction, count] of value.matchAll(TRACK_COUNT_PATTERN)) {
    tracking[direction === 'ahead' ? 'ahead' : 'behind'] = Number(count)
  }
  return tracking
}

/** A ref name the log may be scoped to: a branch namespace, no range or option syntax. */
export function isGitHistoryBranchRefName(ref: string): boolean {
  const prefix = ref.startsWith(LOCAL_PREFIX)
    ? LOCAL_PREFIX
    : ref.startsWith(REMOTE_PREFIX)
      ? REMOTE_PREFIX
      : null
  if (!prefix || ref.length === prefix.length) {
    return false
  }
  // Why: git check-ref-format forbids these; rejecting them keeps range/reflog syntax out of `git log`.
  return !/\.\.|@\{|[\s~^:?*[\\]/.test(ref)
}

export function parseGitHistoryBranches(stdout: string): GitHistoryBranch[] {
  const branches: GitHistoryBranch[] = []
  for (const rawLine of stdout.split('\n')) {
    const [fullName, revision, head, upstream, track] = rawLine.replace(/\r$/, '').split('\0')
    if (!fullName || !revision) {
      continue
    }
    const isLocal = fullName.startsWith(LOCAL_PREFIX)
    const isRemote = fullName.startsWith(REMOTE_PREFIX)
    // Why skip remote HEAD: it's a symbolic alias of a branch already listed.
    if ((!isLocal && !isRemote) || (isRemote && fullName.endsWith('/HEAD'))) {
      continue
    }
    const branch: GitHistoryBranch = {
      fullName,
      name: fullName.slice(isLocal ? LOCAL_PREFIX.length : REMOTE_PREFIX.length),
      kind: isLocal ? 'local' : 'remote',
      revision,
      isHead: head?.trim() === '*'
    }
    const upstreamName = upstream?.trim()
    if (isLocal && upstreamName) {
      branch.upstream = upstreamName
      Object.assign(branch, parseGitHistoryBranchTrack(track))
    }
    branches.push(branch)
  }
  return branches
}

export async function loadGitHistoryBranches(
  git: GitHistoryExecutor,
  cwd: string
): Promise<GitHistoryBranchList> {
  const { stdout } = await git(
    [
      'for-each-ref',
      `--count=${GIT_HISTORY_BRANCH_LIMIT + 1}`,
      `--format=${BRANCH_FORMAT}`,
      'refs/heads',
      'refs/remotes'
    ],
    cwd
  )
  const branches = parseGitHistoryBranches(stdout)
  return {
    branches: branches.slice(0, GIT_HISTORY_BRANCH_LIMIT),
    truncated: branches.length > GIT_HISTORY_BRANCH_LIMIT
  }
}
