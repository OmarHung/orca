import { ipcMain } from 'electron'
import type {
  GitHistoryOptions,
  GitHistoryResult
} from '../../../shared/git/history/git-history-types'
import { getHistory, getHistoryRefs } from '../../git/history'
import { getConnectionExecutionHostId } from '../../../shared/execution-host'
import { requireReachableGitRoute } from '../../providers/execution-host-provider-dispatch'
import { readWorktreeGitUnlessWslStopped } from './wsl-gated-worktree-git-read'
import { readGitHistoryIpcOptions } from './git-history-ipc-options'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

export function registerFilesystemGitHistoryHandlers({ store }: FilesystemHandlerContext): void {
  ipcMain.handle(
    'git:refs',
    async (_event, args: { worktreePath: string; connectionId?: string; query?: string }) => {
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        false,
        (worktreePath, gitOptions) => getHistoryRefs(worktreePath, args.query, gitOptions)
      )
    }
  )

  ipcMain.handle(
    'git:history',
    async (
      _event,
      args: {
        worktreePath: string
        connectionId?: string
        /** Refresh: a user act that may start a stopped WSL distro. */
        wakeWslDistro?: boolean
      } & GitHistoryOptions
    ): Promise<GitHistoryResult> => {
      const options = readGitHistoryIpcOptions(args)
      requireReachableGitRoute(getConnectionExecutionHostId(args.connectionId))
      return readWorktreeGitUnlessWslStopped(
        store,
        args.worktreePath,
        args.wakeWslDistro,
        (worktreePath, gitOptions) => getHistory(worktreePath, { ...options, ...gitOptions })
      )
    }
  )
}
