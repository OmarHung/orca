import { ipcMain } from 'electron'
import { parseGitBranchAction } from '../../../../shared/git-branch-action/git-branch-action-parse'
import type { GitBranchActionResult } from '../../../../shared/git-branch-action/git-branch-action-types'
import { runLocalGitBranchAction } from '../../../git/git-branch-action'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../../providers/ssh-git-dispatch'
import { resolveRegisteredWorktreePath } from '../../registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../../local-worktree-runtime-options'
import type { FilesystemHandlerContext } from '../filesystem-handler-context'

/** Git Log branch/commit actions (checkout, merge, rebase, reset…), local or over SSH. */
export function registerGitBranchActionHandlers(context: FilesystemHandlerContext): void {
  const { store } = context

  ipcMain.handle(
    'git:branchAction',
    async (
      _event,
      args: { worktreePath: string; action: unknown; connectionId?: string }
    ): Promise<GitBranchActionResult> => {
      const action = parseGitBranchAction(args.action)
      if (args.connectionId) {
        const provider = getSshGitProvider(args.connectionId)
        if (!provider) {
          throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
        }
        return provider.runBranchAction(args.worktreePath, action)
      }
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      return runLocalGitBranchAction(worktreePath, action, gitOptions)
    }
  )
}
