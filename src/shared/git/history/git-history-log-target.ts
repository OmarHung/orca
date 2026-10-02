import { GIT_HISTORY_COMMIT_FORMAT, parseGitHistoryLog } from './git-history-log-parser'
import type { GitHistoryExecutor, GitHistoryOptions } from './git-history-types'
import { isGitHistoryBranchRefName } from './git-history-branches'

export type GitHistoryLogTarget = { scope: 'head' } | { scope: 'ref' | 'all'; revisions: string[] }

// Why resolve to oids: `git log` then never sees user-chosen text, so ref names can't smuggle options or ranges.
export async function resolveLogTarget(
  git: GitHistoryExecutor,
  cwd: string,
  options: GitHistoryOptions,
  resolveCommit: (git: GitHistoryExecutor, cwd: string, ref: string) => Promise<string | null>
): Promise<GitHistoryLogTarget> {
  if (options.allBranches) {
    return { scope: 'all', revisions: ['--branches', '--remotes', 'HEAD'] }
  }
  const revision = options.revision?.trim()
  if (!revision) {
    return { scope: 'head' }
  }
  if (!isGitHistoryBranchRefName(revision)) {
    throw new Error(`Not a branch: ${revision}`)
  }
  const oid = await resolveCommit(git, cwd, revision)
  if (!oid) {
    throw new Error(`Branch not found: ${revision}`)
  }
  return { scope: 'ref', revisions: [oid] }
}

export async function runHistoryLog(
  git: GitHistoryExecutor,
  cwd: string,
  limit: number,
  revisions: string[],
  {
    skip,
    shortstat = false,
    stdin = false,
    path
  }: { skip: number; shortstat?: boolean; stdin?: boolean; path?: string }
) {
  const { stdout } = await git(
    [
      'log',
      '--no-show-signature',
      '--no-color',
      `--format=${GIT_HISTORY_COMMIT_FORMAT}`,
      '-z',
      '--topo-order',
      '--decorate=full',
      ...(shortstat ? ['--shortstat'] : []),
      ...(skip > 0 ? [`--skip=${skip}`] : []),
      `-n${limit + 1}`,
      ...(stdin ? ['--stdin'] : revisions),
      ...(path ? ['--', path] : [])
    ],
    cwd,
    stdin ? `${revisions.join('\n')}\n` : undefined
  )
  return parseGitHistoryLog(stdout)
}
