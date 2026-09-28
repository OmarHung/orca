import { useEffect, useRef } from 'react'
import type { editor } from 'monaco-editor'
import { useDiffEditorRegistration } from '../diff-navigation-context'
import {
  createChangeMarkerController,
  type ChangeMarkerController
} from './change-marker-controller'

/**
 * Change-marker gutter for a file editor. `baseline` is the HEAD text; null
 * turns the markers off. While on, the header's change navigation drives them.
 */
export function useMonacoChangeMarkers(
  mountedEditor: editor.IStandaloneCodeEditor | null,
  baseline: string | null,
  languageId: string,
  isDark: boolean
): void {
  const { registerDiffEditor, unregisterDiffEditor } = useDiffEditorRegistration()
  const controllerRef = useRef<ChangeMarkerController | null>(null)

  useEffect(() => {
    if (!mountedEditor || baseline === null) {
      return
    }
    const controller = createChangeMarkerController(mountedEditor, baseline, languageId)
    controllerRef.current = controller
    registerDiffEditor(controller.navigation)
    return () => {
      unregisterDiffEditor(controller.navigation)
      controller.dispose()
      controllerRef.current = null
    }
  }, [baseline, languageId, mountedEditor, registerDiffEditor, unregisterDiffEditor])

  // Why: overview-ruler colors are resolved from CSS tokens, which flip with the theme.
  useEffect(() => {
    controllerRef.current?.refreshColors()
  }, [isDark])
}
