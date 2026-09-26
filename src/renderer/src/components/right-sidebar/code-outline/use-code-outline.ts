import { useEffect, useState, useSyncExternalStore } from 'react'
import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import { editorModelRegistry } from '@/lib/editor-model-registry'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import type { CodeOutlineSymbol } from './code-outline-types'
import { isCodeOutlineLanguage, loadCodeOutline } from './code-outline-source'

const REFRESH_DEBOUNCE_MS = 400
// Why: TS/JS workers can fail transiently right after a cold start; retry before showing an error.
const MAX_OUTLINE_RETRIES = 3
const OUTLINE_RETRY_MS = 1_500

export type CodeOutlineState =
  | { status: 'no-file' }
  | { status: 'not-loaded'; fileName: string }
  | { status: 'unsupported'; fileName: string }
  | { status: 'loading'; fileName: string }
  | { status: 'error'; fileName: string }
  | { status: 'ready'; fileName: string; symbols: CodeOutlineSymbol[] }

export type CodeOutlineTarget = { fileId: string; filePath: string; fileName: string }

export function useActiveOutlineTarget(): CodeOutlineTarget | null {
  const fileId = useAppStore((s) => s.activeFileId)
  const file = useAppStore((s) =>
    s.activeFileId ? s.openFiles.find((openFile) => openFile.id === s.activeFileId) : undefined
  )
  // Why: diff and conflict tabs render a different model than the file's own.
  if (!fileId || !file || file.diffSource || file.conflictReview) {
    return null
  }
  const fileName = file.relativePath.split(/[\\/]/).at(-1) ?? file.relativePath
  return { fileId, filePath: file.filePath, fileName }
}

function findModel(monaco: typeof Monaco, filePath: string): Monaco.editor.ITextModel | null {
  return monaco.editor.getModel(monaco.Uri.parse(toEditorModelUri(filePath)))
}

/** Tracks the model of `filePath`, including one created or disposed after the tab opened. */
function useEditorModel(
  monaco: typeof Monaco | null,
  filePath: string | null
): Monaco.editor.ITextModel | null {
  const [model, setModel] = useState<Monaco.editor.ITextModel | null>(null)
  useEffect(() => {
    if (!monaco || !filePath) {
      setModel(null)
      return
    }
    const refresh = (): void => setModel(findModel(monaco, filePath))
    refresh()
    const created = monaco.editor.onDidCreateModel(refresh)
    // Why: the model is still registered during this event, so re-check once it's gone.
    const disposed = monaco.editor.onWillDisposeModel(() => queueMicrotask(refresh))
    return () => {
      created.dispose()
      disposed.dispose()
    }
  }, [monaco, filePath])
  return model
}

export function useCodeOutline(): { target: CodeOutlineTarget | null; state: CodeOutlineState } {
  const target = useActiveOutlineTarget()
  const monaco = useSyncExternalStore(editorModelRegistry.subscribe, editorModelRegistry.get)
  const model = useEditorModel(monaco, target?.filePath ?? null)
  const [state, setState] = useState<CodeOutlineState>({ status: 'no-file' })
  const fileName = target?.fileName ?? null

  useEffect(() => {
    if (!fileName) {
      setState({ status: 'no-file' })
      return
    }
    if (!monaco || !model) {
      setState({ status: 'not-loaded', fileName })
      return
    }
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const compute = (retriesLeft = MAX_OUTLINE_RETRIES): void => {
      const current = ++generation
      if (!isCodeOutlineLanguage(model.getLanguageId())) {
        setState({ status: 'unsupported', fileName })
        return
      }
      loadCodeOutline(monaco, model)
        .then((symbols) => {
          if (current !== generation) {
            return
          }
          setState(
            symbols === null
              ? { status: 'unsupported', fileName }
              : { status: 'ready', fileName, symbols }
          )
        })
        .catch((error: unknown) => {
          if (current !== generation) {
            return
          }
          if (retriesLeft > 0) {
            console.warn('[code-outline] retrying after a failed outline', error)
            timer = setTimeout(() => compute(retriesLeft - 1), OUTLINE_RETRY_MS)
            return
          }
          console.error('[code-outline] failed to build outline', error)
          setState({ status: 'error', fileName })
        })
    }
    const scheduleCompute = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => compute(), REFRESH_DEBOUNCE_MS)
    }
    setState({ status: 'loading', fileName })
    compute()
    const contentSub = model.onDidChangeContent(scheduleCompute)
    const languageSub = model.onDidChangeLanguage(() => compute())
    return () => {
      generation += 1
      if (timer !== null) {
        clearTimeout(timer)
      }
      contentSub.dispose()
      languageSub.dispose()
    }
  }, [fileName, monaco, model])

  return { target, state }
}
