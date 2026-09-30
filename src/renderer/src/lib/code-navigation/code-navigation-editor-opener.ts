import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { detectLanguage } from '@/lib/language-detect'
import { getRelativePathInsideRoot } from '@/lib/path'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import { findEditTabForModelUri, localWorkspaceRoot } from './code-navigation-workspace'
import { filePathForNavigationUri } from './code-navigation-preview-models'

type TargetPosition = { lineNumber: number; column: number }

function targetPositionOf(
  selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined
): TargetPosition | null {
  if (!selectionOrPosition) {
    return null
  }
  if ('startLineNumber' in selectionOrPosition) {
    return {
      lineNumber: selectionOrPosition.startLineNumber,
      column: selectionOrPosition.startColumn
    }
  }
  return { lineNumber: selectionOrPosition.lineNumber, column: selectionOrPosition.column }
}

/** Opens the target in an Orca tab of the source tab's workspace and moves the cursor there. */
export function openNavigationTarget(
  sourceTab: OpenFile,
  requestedPath: string,
  position: TargetPosition | null
): void {
  const store = useAppStore.getState()
  // Why: servers may spell a path differently (e.g. a lowercase Windows drive); reusing an open
  // tab's own path keeps the jump from opening the same file twice.
  const targetPath =
    findEditTabForModelUri(store, toEditorModelUri(requestedPath))?.filePath ?? requestedPath
  const root = localWorkspaceRoot(store, sourceTab.worktreeId)
  const runtimeEnvironmentId = sourceTab.runtimeEnvironmentId ?? null
  const fileId = store.openFile(
    {
      filePath: targetPath,
      // Why the absolute path outside the root: that is how external files are opened elsewhere.
      relativePath: getRelativePathInsideRoot(targetPath, root) ?? targetPath,
      worktreeId: sourceTab.worktreeId,
      language: detectLanguage(targetPath),
      mode: 'edit',
      runtimeEnvironmentId
    },
    { suppressActiveRuntimeFallback: runtimeEnvironmentId === null }
  )
  if (!position) {
    return
  }
  store.setPendingEditorReveal(null)
  // Why two frames: the target tab mounts Monaco asynchronously, as in terminal link navigation.
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      useAppStore.getState().setPendingEditorReveal({
        filePath: targetPath,
        fileId,
        line: position.lineNumber,
        column: position.column,
        matchLength: 0
      })
    )
  )
}

/**
 * Standalone Monaco can only reveal positions inside the model it is showing; this sends every
 * jump to another file (go to definition, a peek result) to an Orca tab instead.
 */
export function registerCodeNavigationEditorOpener(
  monaco: Pick<typeof Monaco, 'editor'>
): Monaco.IDisposable {
  return monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      const sourceModel = source.getModel()
      const targetPath = filePathForNavigationUri(resource)
      if (!sourceModel || !targetPath) {
        return false
      }
      // Same model: Monaco's own handler reveals it in place.
      if (resource.toString() === sourceModel.uri.toString()) {
        return false
      }
      const sourceTab = findEditTabForModelUri(useAppStore.getState(), sourceModel.uri.toString())
      if (!sourceTab) {
        return false
      }
      openNavigationTarget(sourceTab, targetPath, targetPositionOf(selectionOrPosition))
      return true
    }
  })
}
