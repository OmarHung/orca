// Dry-runs a rebase with `git merge-tree` to find every fork commit that conflicts, without touching
// the worktree, index or refs (it only writes unreferenced objects that gc later collects).
import { execFileSync, spawnSync } from 'node:child_process'

/** merge-tree exits 1 when the merge finished with conflicts; any other non-zero is a failure. */
const MERGE_TREE_CONFLICTED = 1
const PREVIEW_IDENTITY = {
  GIT_AUTHOR_NAME: 'orca-sync-preview',
  GIT_AUTHOR_EMAIL: 'orca-sync-preview@localhost',
  GIT_COMMITTER_NAME: 'orca-sync-preview',
  GIT_COMMITTER_EMAIL: 'orca-sync-preview@localhost'
}

function mergeTree(cwd, sha, parent, strategyOption) {
  const result = spawnSync(
    'git',
    [
      'merge-tree',
      '--write-tree',
      '--name-only',
      ...(strategyOption ? ['-X', strategyOption] : []),
      `--merge-base=${sha}^`,
      parent,
      sha
    ],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  if (result.status !== 0 && result.status !== MERGE_TREE_CONFLICTED) {
    throw new Error(result.stderr?.trim() || `git merge-tree exited with ${result.status}`)
  }
  const [tree, ...rest] = result.stdout.split('\n')
  const end = rest.indexOf('')
  return {
    tree,
    conflicted: result.status === MERGE_TREE_CONFLICTED,
    files: end === -1 ? rest : rest.slice(0, end)
  }
}

/**
 * Replays `base..branch` onto `onto` in memory and returns each commit that conflicts, with the
 * files it conflicts in. A conflicted commit continues with its own side of each hunk, so later
 * commits are checked against the fork's intent; a hand resolution can still differ from that.
 */
export function previewRebaseConflicts({ cwd, base, branch, onto }) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...PREVIEW_IDENTITY }
    }).trim()
  const commits = git('rev-list', '--reverse', '--no-merges', `${base}..${branch}`)
    .split('\n')
    .filter(Boolean)
  let parent = git('rev-parse', `${onto}^{commit}`)
  const conflicts = []
  for (const sha of commits) {
    let { tree, conflicted, files } = mergeTree(cwd, sha, parent)
    if (conflicted) {
      conflicts.push({ sha, subject: git('log', '-1', '--format=%s', sha), files })
      tree = mergeTree(cwd, sha, parent, 'theirs').tree
    }
    parent = git('commit-tree', tree, '-p', parent, '-m', `sync preview of ${sha}`)
  }
  return conflicts
}
