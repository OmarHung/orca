import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { RepoRelocateResult } from '../../../shared/repo-relocation-types'
import { prepareLocalWorktreeRootForRepo } from '../../workspaces/creation/worktree-root-preparation'
import { invalidateAuthorizedRootsCache } from '../worktrees/removal/registered-worktree-roots-cache'
import { notifyReposChanged } from './repos-changed-notification'
import { relocateLocalRepo } from './repo-relocation'

export function registerRepoRelocateHandler(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: Pick<OrcaRuntimeService, 'notifyWorktreeFolderRenamed'>
): void {
  ipcMain.handle(
    'repos:relocate',
    async (_event, args: { repoId: string; path: string }): Promise<RepoRelocateResult> => {
      const result = await relocateLocalRepo(store, args.repoId, args.path)
      if ('error' in result) {
        return result
      }
      invalidateAuthorizedRootsCache()
      void prepareLocalWorktreeRootForRepo(store, result.repo)
      notifyReposChanged(mainWindow)
      // Re-key renderer tabs and sessions instead of treating the old ids as deleted workspaces.
      for (const [oldId, newId] of result.worktreeIds) {
        runtime.notifyWorktreeFolderRenamed(result.repo.id, oldId, newId)
      }
      return { repo: result.repo }
    }
  )
}
