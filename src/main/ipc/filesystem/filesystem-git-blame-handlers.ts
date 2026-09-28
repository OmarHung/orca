import { ipcMain } from 'electron'
import type { GitBlameResult } from '../../../shared/git-blame'
import { getBlame } from '../../git/blame'
import { requireReachableGitRoute } from '../../providers/execution-host-provider-dispatch'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { resolveRegisteredWorktreePath } from '../registered-worktree-roots-cache'
import { validateGitRelativeFilePath } from './filesystem-path-containment'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

export function registerFilesystemGitBlameHandlers({ store }: FilesystemHandlerContext): void {
  ipcMain.handle(
    'git:blame',
    async (
      _event,
      args: { worktreePath: string; filePath: string; connectionId?: string }
    ): Promise<GitBlameResult> => {
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, store)
      const filePath = validateGitRelativeFilePath(worktreePath, args.filePath)
      const gitOptions = getLocalGitOptionsForRegisteredWorktree(
        store,
        args.worktreePath,
        worktreePath
      )
      // Why: a hint beside the caret must never queue ahead of status polls or user actions.
      return getBlame(worktreePath, filePath, { ...gitOptions, admissionTier: 'background' })
    }
  )
}
