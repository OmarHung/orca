import { getRelativePathInsideRoot } from '@/lib/path'
import { isEditorTabContentType } from '@/store/slices/editor/tabs/editor-tab-content-type'
import type { OpenFile } from '@/store/slices/editor/types/open-file'
import type { AppState } from '@/store/types'

type LocateTargetState = Pick<
  AppState,
  | 'activeFileId'
  | 'activeTabType'
  | 'activeWorktreeId'
  | 'groupsByWorktree'
  | 'openFiles'
  | 'unifiedTabsByWorktree'
>

function getVisibleEditorFileIds(state: LocateTargetState, worktreeId: string): string[] {
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  return (state.groupsByWorktree[worktreeId] ?? []).flatMap((group) => {
    const activeTab = tabs.find((tab) => tab.id === group.activeTabId)
    return activeTab && isEditorTabContentType(activeTab.contentType) ? [activeTab.entityId] : []
  })
}

// Conflict-review and combined-diff tabs store a root in filePath; check-details has no file at all.
function ownsConcreteFile(file: OpenFile): boolean {
  if (file.mode === 'diff') {
    return !file.diffSource?.startsWith('combined-')
  }
  return file.mode === 'edit' || file.mode === 'markdown-preview'
}

/** The file on screen in the main area that the explorer can select, even when a terminal split holds focus. */
export function getFileExplorerLocateTarget(
  state: LocateTargetState,
  worktreePath: string | null
): string | null {
  const { activeFileId, activeTabType, activeWorktreeId, openFiles } = state
  if (!activeWorktreeId) {
    return null
  }
  const visibleFileIds =
    activeTabType === 'editor' ? [] : getVisibleEditorFileIds(state, activeWorktreeId)
  const fileId =
    activeTabType === 'editor' || (activeFileId && visibleFileIds.includes(activeFileId))
      ? activeFileId
      : visibleFileIds[0]
  const file = openFiles.find(
    (candidate) => candidate.id === fileId && candidate.worktreeId === activeWorktreeId
  )
  if (!file || !ownsConcreteFile(file)) {
    return null
  }
  return getRelativePathInsideRoot(file.filePath, worktreePath) ? file.filePath : null
}
