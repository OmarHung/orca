import type { GitHistoryExecutor, GitHistoryOptions, GitHistoryResult } from './git-history-types'

const CHERRY_PICK_TRAILER = 'cherry picked from commit'
const CHERRY_PICK_TRAILER_PATTERN = /cherry picked from commit ([0-9a-f]{40})/g

type CurrentBranchComparison = Pick<GitHistoryResult, 'headMergeBases' | 'cherryPickedIds'>

/** How a logged branch (`revisions` holds its one resolved oid) relates to HEAD. */
export async function loadCurrentBranchComparison(
  git: GitHistoryExecutor,
  cwd: string,
  headOid: string,
  revisions: readonly string[],
  options: Pick<GitHistoryOptions, 'markCherryPicks'>
): Promise<CurrentBranchComparison> {
  const [revision] = revisions
  if (!revision || revisions.length !== 1) {
    return {}
  }
  const [headMergeBases, cherryPickedIds] = await Promise.all([
    loadHeadMergeBases(git, cwd, headOid, revision),
    options.markCherryPicks === true && revision !== headOid
      ? loadCherryPickedIds(git, cwd, headOid, revision)
      : undefined
  ])
  return {
    ...(headMergeBases ? { headMergeBases } : {}),
    ...(cherryPickedIds ? { cherryPickedIds } : {})
  }
}

/**
 * Best common ancestors of HEAD and the branch. Undefined when git fails — including unrelated
 * histories, where merge-base exits 1 — so no commit is claimed for the current branch.
 */
async function loadHeadMergeBases(
  git: GitHistoryExecutor,
  cwd: string,
  headOid: string,
  revision: string
): Promise<string[] | undefined> {
  if (revision === headOid) {
    return [headOid]
  }
  try {
    const { stdout } = await git(['merge-base', '--all', headOid, revision], cwd)
    const oids = splitLines(stdout)
    return oids.length > 0 ? oids : undefined
  } catch {
    return undefined
  }
}

/**
 * Branch-only commits HEAD already has as a copy, like JetBrains' non-picked highlighting: same
 * patch-id, or named by a `cherry-pick -x` trailer on HEAD's side (which survives a conflict).
 */
async function loadCherryPickedIds(
  git: GitHistoryExecutor,
  cwd: string,
  headOid: string,
  revision: string
): Promise<string[] | undefined> {
  const range = `${headOid}...${revision}`
  try {
    const [marked, trailers] = await Promise.all([
      git(['log', '--cherry-mark', '--right-only', '--no-merges', '--format=%m %H', range], cwd),
      git(
        [
          'log',
          '--left-only',
          '--no-merges',
          '-F',
          `--grep=${CHERRY_PICK_TRAILER}`,
          '--format=%B',
          range
        ],
        cwd
      )
    ])
    const branchOnlyIds = new Set<string>()
    const picked = new Set<string>()
    for (const line of splitLines(marked.stdout)) {
      const [mark, oid] = line.split(' ')
      if (oid) {
        branchOnlyIds.add(oid)
        if (mark === '=') {
          picked.add(oid)
        }
      }
    }
    for (const [, oid] of trailers.stdout.matchAll(CHERRY_PICK_TRAILER_PATTERN)) {
      if (oid && branchOnlyIds.has(oid)) {
        picked.add(oid)
      }
    }
    return [...picked]
  } catch {
    return undefined
  }
}

function splitLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}
