import type { RequestContext } from './dispatcher'
import { GitHandlerOperationContext } from './git-handler-operation-context'
import { parseGitBranchAction } from '../shared/git-branch-action/git-branch-action-parse'
import { runGitBranchAction } from '../shared/git-branch-action/git-branch-action-runner'
import { runWithGitWorktreeOperationLock } from '../shared/git-worktree-operation-lock'

/** Git Log branch/commit actions; the generic git.exec stays read-only, so each one is validated here. */
export class GitHandlerBranchActionOperations extends GitHandlerOperationContext {
  async branchAction(params: Record<string, unknown>, context?: RequestContext) {
    const worktreePath = params.worktreePath
    if (typeof worktreePath !== 'string' || worktreePath.length === 0) {
      throw new Error('Invalid branch action: worktreePath')
    }
    const action = parseGitBranchAction(params.action)
    return runWithGitWorktreeOperationLock(worktreePath, context?.signal, () =>
      this.runWithGitReadCacheClear(() =>
        runGitBranchAction(
          (args) =>
            this.git(args, worktreePath, { signal: context?.signal, terminationBarrier: true }),
          action
        )
      )
    )
  }
}
