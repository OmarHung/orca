import type {
  GitHistoryBranch,
  GitHistoryBranchList,
  GitHistoryExecutor
} from './git-history-types'

/** Cap so a repo with thousands of remote branches cannot flood the wire or the tree. */
export const GIT_HISTORY_BRANCH_LIMIT = 1000

const LOCAL_PREFIX = 'refs/heads/'
const REMOTE_PREFIX = 'refs/remotes/'
// Why %(HEAD) and %(upstream:short): both predate the Git 2.25 baseline.
const BRANCH_FORMAT = '%(refname)%00%(objectname)%00%(HEAD)%00%(upstream:short)'

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
    const [fullName, revision, head, upstream] = rawLine.replace(/\r$/, '').split('\0')
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
