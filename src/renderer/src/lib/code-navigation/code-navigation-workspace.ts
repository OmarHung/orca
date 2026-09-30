import type { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { getFolderWorkspaceConnectionId } from '@/lib/folder-workspace-connection'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import { getRelativePathInsideRoot } from '@/lib/path'
import { isLocalDebugTarget } from '@/components/debug/debug-launch'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  codeNavigationLanguageForPath,
  type CodeNavigationLanguage
} from './code-navigation-languages'

type AppState = ReturnType<typeof useAppStore.getState>

const WSL_UNC_PREFIX = /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i

export type CodeNavigationFileContext = CodeNavigationLanguage & {
  tab: OpenFile
  root: string
}

/** The editable tab showing this Monaco model, if any. */
export function findEditTabForModelUri(state: AppState, modelUri: string): OpenFile | null {
  return (
    state.openFiles.find(
      (file) => file.mode === 'edit' && toEditorModelUri(file.filePath) === modelUri
    ) ?? null
  )
}

function localFolderWorkspaceRoot(state: AppState, workspaceId: string, folderId: string) {
  if (
    getResolvedExecutionHostIdForWorktree(state, workspaceId) !== LOCAL_EXECUTION_HOST_ID ||
    getFolderWorkspaceConnectionId(state, folderId) !== null
  ) {
    return null
  }
  const folder = state.folderWorkspaces.find((candidate) => candidate.id === folderId)
  return folder && !WSL_UNC_PREFIX.test(folder.folderPath) ? folder.folderPath : null
}

/** The workspace's root when it lives on this machine; language servers only run here. */
export function localWorkspaceRoot(state: AppState, worktreeId: string): string | null {
  const scope = parseWorkspaceKey(worktreeId)
  if (scope?.type === 'folder') {
    return localFolderWorkspaceRoot(state, worktreeId, scope.folderWorkspaceId)
  }
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  const repo = worktree ? state.repos.find((candidate) => candidate.id === worktree.repoId) : null
  if (!worktree || !repo) {
    return null
  }
  const isLocal = isLocalDebugTarget({
    repoHostId: getRepoExecutionHostId(repo),
    activeRuntimeIsLocal: getActiveRuntimeTarget(state.settings).kind === 'local',
    worktreePath: worktree.path
  })
  return isLocal ? worktree.path : null
}

/** Everything a language-server query needs for this model, or null to use Monaco's own. */
export function resolveCodeNavigationContext(
  state: AppState,
  modelUri: string
): CodeNavigationFileContext | null {
  const tab = findEditTabForModelUri(state, modelUri)
  if (!tab || tab.runtimeEnvironmentId || tab.externalSshTargetId) {
    return null
  }
  const language = codeNavigationLanguageForPath(tab.filePath)
  const root = language ? localWorkspaceRoot(state, tab.worktreeId) : null
  // Why inside the root: a server only understands files of the workspace it loaded.
  if (!language || !root || getRelativePathInsideRoot(tab.filePath, root) === null) {
    return null
  }
  return { ...language, tab, root }
}
