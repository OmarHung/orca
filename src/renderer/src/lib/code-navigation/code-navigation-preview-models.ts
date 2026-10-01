import type * as Monaco from 'monaco-editor'
import { detectLanguage } from '@/lib/language-detect'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'
import {
  hasOpenMonacoPeekReferences,
  onDidCloseMonacoPeekReferences
} from '../monaco-peek-references-lifecycle'

type MonacoModels = Pick<typeof Monaco, 'editor' | 'Uri'>

/**
 * Why a scheme of its own: Monaco's peek widget can only preview files that already have a model,
 * and a `file://` model would be adopted by the tab that later opens the file. Preview models
 * stay out of the tabs' model lifecycle entirely.
 */
export const CODE_NAVIGATION_PREVIEW_SCHEME = 'orca-lsp-preview'

const PREVIEW_IDLE_MS = 5 * 60_000

const previewLastUsedByMonaco = new WeakMap<MonacoModels, Map<string, number>>()
const previewSweepTimers = new WeakMap<MonacoModels, ReturnType<typeof setTimeout>>()

function previewLastUsedAt(monaco: MonacoModels): Map<string, number> {
  const existing = previewLastUsedByMonaco.get(monaco)
  if (existing) {
    return existing
  }
  const created = new Map<string, number>()
  previewLastUsedByMonaco.set(monaco, created)
  return created
}

function clearPreviewSweep(monaco: MonacoModels): void {
  const timer = previewSweepTimers.get(monaco)
  if (timer !== undefined) {
    clearTimeout(timer)
    previewSweepTimers.delete(monaco)
  }
}

function schedulePreviewSweep(monaco: MonacoModels, delay: number = PREVIEW_IDLE_MS): void {
  if (previewSweepTimers.has(monaco)) {
    return
  }
  const timer = setTimeout(
    () => {
      previewSweepTimers.delete(monaco)
      sweepIdlePreviewModels(monaco)
    },
    Math.max(1, delay)
  )
  previewSweepTimers.set(monaco, timer)
}

/**
 * The URI Monaco should show for a navigation target: the open tab's model when there is one,
 * otherwise a read-only-in-spirit preview model holding `previewText`.
 */
export function navigationUriForPath(
  monaco: MonacoModels,
  path: string,
  previewText: string | undefined,
  now: number = Date.now()
): Monaco.Uri {
  const fileUri = monaco.Uri.parse(toEditorModelUri(path))
  if (monaco.editor.getModel(fileUri) || previewText === undefined) {
    return fileUri
  }
  const previewUri = fileUri.with({ scheme: CODE_NAVIGATION_PREVIEW_SCHEME })
  const existing = monaco.editor.getModel(previewUri)
  if (!existing) {
    monaco.editor.createModel(previewText, detectLanguage(path), previewUri)
  } else if (existing.getValue() !== previewText) {
    existing.setValue(previewText)
  }
  previewLastUsedAt(monaco).set(previewUri.toString(), now)
  schedulePreviewSweep(monaco)
  return previewUri
}

/** The file a navigation URI points at, or null for anything that is not a file. */
export function filePathForNavigationUri(uri: Monaco.Uri): string | null {
  if (uri.scheme === 'file') {
    return uri.fsPath
  }
  if (uri.scheme === CODE_NAVIGATION_PREVIEW_SCHEME) {
    return uri.with({ scheme: 'file' }).fsPath
  }
  return null
}

/** Disposes preview models nothing has shown for a while. */
export function sweepIdlePreviewModels(monaco: MonacoModels, now: number = Date.now()): void {
  clearPreviewSweep(monaco)
  if (hasOpenMonacoPeekReferences()) {
    return
  }

  const lastUsed = previewLastUsedAt(monaco)
  let nextSweepDelay: number | null = null
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme !== CODE_NAVIGATION_PREVIEW_SCHEME) {
      continue
    }
    const key = model.uri.toString()
    const remaining = PREVIEW_IDLE_MS - (now - (lastUsed.get(key) ?? 0))
    if (!model.isAttachedToEditor() && remaining <= 0) {
      lastUsed.delete(key)
      model.dispose()
    } else {
      const delay = model.isAttachedToEditor() ? PREVIEW_IDLE_MS : remaining
      nextSweepDelay = nextSweepDelay === null ? delay : Math.min(nextSweepDelay, delay)
    }
  }
  if (nextSweepDelay !== null) {
    schedulePreviewSweep(monaco, nextSweepDelay)
  }
}

/** Keeps peek result models alive until the last references widget closes. */
export function installCodeNavigationPreviewModelCleanup(monaco: MonacoModels): () => void {
  const removeCloseListener = onDidCloseMonacoPeekReferences(() => sweepIdlePreviewModels(monaco))
  return () => {
    removeCloseListener()
    clearPreviewSweep(monaco)
    previewLastUsedByMonaco.delete(monaco)
  }
}
