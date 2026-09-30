import type * as Monaco from 'monaco-editor'
import { detectLanguage } from '@/lib/language-detect'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'

type MonacoModels = Pick<typeof Monaco, 'editor' | 'Uri'>

/**
 * Why a scheme of its own: Monaco's peek widget can only preview files that already have a model,
 * and a `file://` model would be adopted by the tab that later opens the file. Preview models
 * stay out of the tabs' model lifecycle entirely.
 */
export const CODE_NAVIGATION_PREVIEW_SCHEME = 'orca-lsp-preview'

const PREVIEW_IDLE_MS = 5 * 60_000

const previewLastUsedAt = new Map<string, number>()

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
  previewLastUsedAt.set(previewUri.toString(), now)
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
  for (const model of monaco.editor.getModels()) {
    if (model.uri.scheme !== CODE_NAVIGATION_PREVIEW_SCHEME || model.isAttachedToEditor()) {
      continue
    }
    const key = model.uri.toString()
    if (now - (previewLastUsedAt.get(key) ?? 0) >= PREVIEW_IDLE_MS) {
      previewLastUsedAt.delete(key)
      model.dispose()
    }
  }
}
