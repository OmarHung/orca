import type { GitHistoryExecutor } from './git-history-types'

// Why a cap: a branch never pushed to an unrelated remote would otherwise list its whole history.
// The log shows at most a few hundred rows, so this covers every row it can show in practice.
export const GIT_HISTORY_UNPUSHED_LIMIT = 1000

/**
 * Logged commits no remote-tracking branch contains, i.e. not pushed anywhere yet. Undefined when
 * the repo has no remote-tracking branches (nothing to compare with) or git fails.
 */
export async function loadUnpushedIds(
  git: GitHistoryExecutor,
  cwd: string,
  revisions: readonly string[]
): Promise<string[] | undefined> {
  try {
    const { stdout: remoteRefs } = await git(
      ['for-each-ref', '--count=1', '--format=%(refname)', 'refs/remotes'],
      cwd
    )
    if (!remoteRefs.trim()) {
      return undefined
    }
    // Why --not --remotes rather than @{u}: a commit on any remote counts as pushed, even when the
    // branch has no upstream or its upstream moved past it.
    const { stdout } = await git(
      [
        'rev-list',
        '--topo-order',
        `--max-count=${GIT_HISTORY_UNPUSHED_LIMIT}`,
        ...revisions,
        '--not',
        '--remotes'
      ],
      cwd
    )
    return stdout.split('\n').filter((line) => line.length > 0)
  } catch {
    return undefined
  }
}
