import { runGitBranchAction } from '../../shared/git-branch-action/git-branch-action-runner'
import type {
  GitBranchAction,
  GitBranchActionResult
} from '../../shared/git-branch-action/git-branch-action-types'
import { runWithGitWorktreeOperationLock } from '../../shared/git-worktree-operation-lock'
import type { GitRuntimeOptions } from './git-runtime-options'
import { gitOptionsForWorktree } from './git-runtime-options'
import { gitExecFileAsync } from './runner'
import { runWithGitReadCacheInvalidation } from './status'

/** Runs a Git Log branch/commit action in a local (or WSL) worktree. */
export async function runLocalGitBranchAction(
  worktreePath: string,
  action: GitBranchAction,
  options: GitRuntimeOptions = {}
): Promise<GitBranchActionResult> {
  const execOptions = {
    ...gitOptionsForWorktree(worktreePath, options),
    admissionTier: 'interactive' as const,
    terminationBarrier: true,
    captureWslLoginShellOutput: true
  }
  return runWithGitWorktreeOperationLock(worktreePath, options.signal, () =>
    runWithGitReadCacheInvalidation(() =>
      runGitBranchAction((args) => gitExecFileAsync(args, execOptions), action)
    )
  )
}
