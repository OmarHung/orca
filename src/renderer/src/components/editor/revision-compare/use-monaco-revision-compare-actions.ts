import { useEffect } from 'react'
import type { editor } from 'monaco-editor'
import { translate } from '@/i18n/i18n'
import { useRevisionCompareStore } from './revision-compare-store'

const CONTEXT_MENU_GROUP = '9_orca_git'

/** "Git: Compare with Branch…" and "Git: Compare with Revision…" in a worktree file's context menu. */
export function useMonacoRevisionCompareActions(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  fileId: string,
  worktreeId: string | undefined,
  relativePath: string | null
): void {
  useEffect(() => {
    if (!mountedEditor || !worktreeId || !relativePath) {
      return
    }
    const request = (mode: 'branch' | 'revision') => () =>
      useRevisionCompareStore.getState().openPicker({ mode, fileId, worktreeId, relativePath })
    const actions = [
      mountedEditor.addAction({
        id: 'orca.git.compareWithBranch',
        label: translate('revisionCompare.withBranchAction', 'Git: Compare with Branch…'),
        contextMenuGroupId: CONTEXT_MENU_GROUP,
        contextMenuOrder: 1,
        run: request('branch')
      }),
      mountedEditor.addAction({
        id: 'orca.git.compareWithRevision',
        label: translate('revisionCompare.withRevisionAction', 'Git: Compare with Revision…'),
        contextMenuGroupId: CONTEXT_MENU_GROUP,
        contextMenuOrder: 2,
        run: request('revision')
      })
    ]
    return () => {
      for (const action of actions) {
        action.dispose()
      }
    }
  }, [fileId, mountedEditor, relativePath, worktreeId])
}
