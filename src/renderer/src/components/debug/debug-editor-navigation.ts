import { useAppStore } from '@/store'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import { getRelativePathInsideRoot } from '@/lib/path'
import { findFirstIndexedWorktree as findWorktreeById } from '@/lib/workspace/ownership/worktree-runtime-owner-index'
import { getOpenedEditFileIdAfterOpen } from '@/store/slices/editor/file-ids/editor-file-ids'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'

/** Opens the file the debugger paused in and scrolls to the paused line. */
export function revealDebugLocation(worktreeId: string, filePath: string, line: number): void {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  const relativePath = getRelativePathInsideRoot(filePath, worktree?.path ?? null) ?? filePath
  state.openFile(
    {
      filePath,
      relativePath,
      worktreeId,
      language: detectLanguage(filePath),
      mode: 'edit'
    },
    { targetGroupId: state.activeGroupIdByWorktree?.[worktreeId] }
  )
  const fileId = getOpenedEditFileIdAfterOpen(useAppStore.getState(), filePath, worktreeId)
  scheduleEditorLineReveal(useAppStore.getState, filePath, line, 1, fileId)
}
