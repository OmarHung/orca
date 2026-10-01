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
import { folderWorkspaceKey, parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { isOrcaLanguageServerFilePath } from '../../../../shared/code-navigation/code-navigation-types'
import {
  codeNavigationLanguageForPath,
  type CodeNavigationLanguage
} from './code-navigation-languages'
import type { NavigationLocation } from './code-navigation-history'

type AppState = ReturnType<typeof useAppStore.getState>

const WSL_UNC_PREFIX = /^[\\/]{2}wsl(\$|\.localhost)[\\/]/i

export type CodeNavigationFileContext = CodeNavigationLanguage & {
  tab: OpenFile
  root: string
}

/** The editable tab showing this Monaco model, if any. */
export function findEditTabForModelUri(state: AppState, modelUri: string): OpenFile | null {
  const matches = state.openFiles.filter(
    (file) => file.mode === 'edit' && toEditorModelUri(file.filePath) === modelUri
  )
  if (matches.length <= 1) {
    return matches[0] ?? null
  }
  // Why: every tab of a path shares one model, and nested projects (a repo at the home folder)
  // can show the same file twice; the editor being used belongs to the active tab or project.
  return (
    matches.find((file) => file.id === state.activeFileId) ??
    matches.find((file) => file.worktreeId === state.activeWorktreeId) ??
    matches[0]
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

function localWorkspaceIds(state: AppState): string[] {
  const worktreeIds = Object.values(state.worktreesByRepo).flatMap((worktrees) =>
    worktrees.map((worktree) => worktree.id)
  )
  const folderIds = state.folderWorkspaces.map((folder) => folderWorkspaceKey(folder.id))
  return [...worktreeIds, ...folderIds]
}

/**
 * The deepest local project containing the file, within `outerRoot`. Why: a project can nest
 * others (a repo at the home folder), and a server rooted there would load every project below.
 */
function innermostLocalRoot(state: AppState, filePath: string, outerRoot: string): string {
  let best = outerRoot
  for (const workspaceId of localWorkspaceIds(state)) {
    const root = localWorkspaceRoot(state, workspaceId)
    if (
      root &&
      root.length > best.length &&
      getRelativePathInsideRoot(root, outerRoot) !== null &&
      getRelativePathInsideRoot(filePath, root) !== null
    ) {
      best = root
    }
  }
  return best
}

/** Everything a language-server query needs for this model, or null to use Monaco's own. */
export function resolveCodeNavigationContext(
  state: AppState,
  modelUri: string
): CodeNavigationFileContext | null {
  const tab = findEditTabForModelUri(state, modelUri)
  if (
    !tab ||
    tab.runtimeEnvironmentId ||
    tab.externalSshTargetId ||
    isOrcaLanguageServerFilePath(tab.filePath)
  ) {
    return null
  }
  const language = codeNavigationLanguageForPath(tab.filePath)
  const root = language ? localWorkspaceRoot(state, tab.worktreeId) : null
  // Why inside the root: a server only understands files of the workspace it loaded.
  if (!language || !root || getRelativePathInsideRoot(tab.filePath, root) === null) {
    return null
  }
  return { ...language, tab, root: innermostLocalRoot(state, tab.filePath, root) }
}

type LocatableEditor = {
  getModel: () => { uri: { toString: () => string } } | null
  getPosition: () => { lineNumber: number; column: number } | null
}

/** Where this editor's cursor is, if it shows an editor tab. */
export function editorNavigationLocation(
  state: AppState,
  editor: LocatableEditor
): NavigationLocation | null {
  const model = editor.getModel()
  const position = editor.getPosition()
  const tab = model ? findEditTabForModelUri(state, model.uri.toString()) : null
  if (!tab || !position) {
    return null
  }
  return {
    worktreeId: tab.worktreeId,
    runtimeEnvironmentId: tab.runtimeEnvironmentId ?? null,
    filePath: tab.filePath,
    line: position.lineNumber,
    column: position.column
  }
}
