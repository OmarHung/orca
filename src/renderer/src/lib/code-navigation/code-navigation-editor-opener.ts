import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { getRelativePathInsideRoot } from '@/lib/path'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import {
  editorNavigationLocation,
  findEditTabForModelUri,
  localWorkspaceRoot
} from './code-navigation-workspace'
import { filePathForNavigationUri } from './code-navigation-preview-models'
import { codeNavigationHistory } from './code-navigation-history'
import { isCodeNavigationMetadataPath } from '../../../../shared/code-navigation/code-navigation-types'

type TargetPosition = { lineNumber: number; column: number }

/** The workspace a navigation target opens in. */
export type NavigationOwner = { worktreeId: string; runtimeEnvironmentId?: string | null }

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

/** Opens the target in an Orca tab of the owner's workspace and moves the cursor there. */
export function openNavigationTarget(
  owner: NavigationOwner,
  requestedPath: string,
  position: TargetPosition | null
): void {
  const store = useAppStore.getState()
  // Why: servers may spell a path differently (e.g. a lowercase Windows drive); reusing an open
  // tab's own path keeps the jump from opening the same file twice.
  const targetPath =
    findEditTabForModelUri(store, toEditorModelUri(requestedPath))?.filePath ?? requestedPath
  const root = localWorkspaceRoot(store, owner.worktreeId)
  const runtimeEnvironmentId = owner.runtimeEnvironmentId ?? null
  const relativePath = getRelativePathInsideRoot(targetPath, root)
  const fileId = store.openFile(
    {
      filePath: targetPath,
      // Why the absolute path outside the root: that is how external files are opened elsewhere.
      relativePath: relativePath ?? targetPath,
      worktreeId: owner.worktreeId,
      language: detectLanguage(targetPath),
      mode: 'edit',
      runtimeEnvironmentId,
      // Why: without it an outside file moves to whichever project contains it (a project at the
      // home folder holds Orca's own server files), switching projects and stranding Back.
      ...(relativePath === null ? { staysInOpeningWorkspace: true } : {}),
      // Decompiled sources are read-only files Orca regenerates; edits could never be saved.
      ...(isCodeNavigationMetadataPath(targetPath) ? { readOnly: true } : {})
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
 * jump to another file (go to definition, a peek result) to an Orca tab instead. Every jump from
 * an editor tab, in-file ones included, passes here first, so it also feeds Navigate Back.
 */
export function registerCodeNavigationEditorOpener(
  monaco: Pick<typeof Monaco, 'editor'>
): Monaco.IDisposable {
  return monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      const sourceModel = source.getModel()
      const targetPath = filePathForNavigationUri(resource)
      const state = useAppStore.getState()
      const from = editorNavigationLocation(state, source)
      if (!sourceModel || !targetPath || !from) {
        return false
      }
      codeNavigationHistory.recordJump(from)
      // Same model: Monaco's own handler reveals it in place.
      if (resource.toString() === sourceModel.uri.toString()) {
        return false
      }
      openNavigationTarget(from, targetPath, targetPositionOf(selectionOrPosition))
      return true
    }
  })
}
