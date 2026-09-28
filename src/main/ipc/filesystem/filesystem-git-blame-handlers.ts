import { ipcMain } from 'electron'
import type { GitBlameResult } from '../../../shared/git-blame'
import { getBlame } from '../../git/blame'
import {
  getSshGitProvider,
  SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE
} from '../../providers/ssh-git-dispatch'
import { resolveRegisteredWorktreePath } from '../registered-worktree-roots-cache'
import { validateGitRelativeFilePath } from '../filesystem-path-containment'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

export function registerFilesystemGitBlameHandlers({ store }: FilesystemHandlerContext): void {
  ipcMain.handle(
    'git:blame',
    async (
      _event,
      args: { worktreePath: string; filePath: string; connectionId?: string }
    ): Promise<GitBlameResult> => {
      if (args.connectionId) {
        const provider = getSshGitProvider(args.connectionId)
        if (!provider) {
          throw new Error(SSH_GIT_PROVIDER_UNAVAILABLE_MESSAGE)
        }
        return provider.getBlame(args.worktreePath, args.filePath)
      }
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
