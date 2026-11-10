import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { RepoRelocateFailure } from '../../../../shared/repo-relocation-types'

/** Only this computer's projects can be pointed at a folder picked here. */
export function canRelocateProjectFolder(repo: Repo): boolean {
  return getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
}

export async function relocateProjectFolder(repo: Repo): Promise<void> {
  const path = await window.api.repos.pickFolder()
  if (!path) {
    return
  }
  try {
    const result = await window.api.repos.relocate({ repoId: repo.id, path })
    if ('error' in result) {
      toast.error(failureMessage(result.error), { description: path })
      return
    }
    toast.success(
      translate('repoRelocate.done', '{{name}} now opens from its new folder', {
        name: result.repo.displayName
      }),
      { description: result.repo.path }
    )
  } catch (error) {
    toast.error(translate('repoRelocate.failed', 'Could not change the project folder'), {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

function failureMessage(failure: RepoRelocateFailure): string {
  switch (failure) {
    case 'not-git-repo':
      return translate('repoRelocate.error.notGitRepo', 'That folder is not a Git repository')
    case 'linked-worktree':
      return translate(
        'repoRelocate.error.linkedWorktree',
        "That folder is a worktree, not the project's main checkout"
      )
    case 'same-path':
      return translate('repoRelocate.error.samePath', 'The project already uses that folder')
    case 'already-registered':
      return translate(
        'repoRelocate.error.alreadyRegistered',
        'Another project already uses that folder'
      )
    case 'locked':
      return translate(
        'repoRelocate.error.locked',
        'This project is being moved to a WSL host, so its folder cannot change now'
      )
    case 'not-directory':
      return translate('repoRelocate.error.notDirectory', 'That folder could not be opened')
    case 'remote-host':
    case 'not-found':
      return translate('repoRelocate.failed', 'Could not change the project folder')
  }
}
