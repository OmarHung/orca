import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { startPythonDebugSession } from './debug-session-controller'

const WSL_UNC_PREFIX = /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i

export function isDebuggableFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.py')
}

/** Phase 0 runs adapters in this process's host only, so the workspace must live here too. */
export function isLocalDebugTarget(options: {
  repoHostId: string
  activeRuntimeIsLocal: boolean
  worktreePath: string
}): boolean {
  return (
    options.repoHostId === LOCAL_EXECUTION_HOST_ID &&
    options.activeRuntimeIsLocal &&
    !WSL_UNC_PREFIX.test(options.worktreePath)
  )
}

export async function debugFile(
  worktreeId: string,
  filePath: string,
  pythonPath?: string
): Promise<void> {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  const repo = worktree ? state.repos.find((candidate) => candidate.id === worktree.repoId) : null
  if (!worktree || !repo) {
    toast.error(translate('debug.workspaceNotFound', 'Could not find the workspace for this file'))
    return
  }
  const local = isLocalDebugTarget({
    repoHostId: getRepoExecutionHostId(repo),
    activeRuntimeIsLocal: getActiveRuntimeTarget(state.settings).kind === 'local',
    worktreePath: worktree.path
  })
  if (!local) {
    toast.error(
      translate(
        'debug.localOnly',
        'Debugging is only available for local workspaces for now (not SSH, WSL or remote runtimes)'
      )
    )
    return
  }
  await startPythonDebugSession({ worktreeId, worktreePath: worktree.path, filePath, pythonPath })
}
