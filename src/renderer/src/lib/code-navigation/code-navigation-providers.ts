import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import type {
  CodeNavigationFeature,
  CodeNavigationRange
} from '../../../../shared/code-navigation/code-navigation-types'
import { CODE_NAVIGATION_MONACO_LANGUAGES } from './code-navigation-languages'
import { resolveCodeNavigationContext } from './code-navigation-workspace'
import { navigationUriForPath, sweepIdlePreviewModels } from './code-navigation-preview-models'
import { rememberSyncedDocument } from './code-navigation-document-lifecycle'

type MonacoApi = typeof Monaco

// Why: matches main's cap; bigger models keep Monaco's in-file navigation only.
const MAX_SYNCED_DOCUMENT_CHARS = 8 * 1024 * 1024

type TextSpanEntry = { fileName: string; textSpan: { start: number; length: number } }

function isTextSpanEntry(value: unknown): value is TextSpanEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'textSpan' in value &&
    typeof value.textSpan === 'object' &&
    value.textSpan !== null &&
    'start' in value.textSpan &&
    typeof value.textSpan.start === 'number' &&
    'length' in value.textSpan &&
    typeof value.textSpan.length === 'number'
  )
}

/**
 * Monaco's own TS worker only sees open models, so it can answer for this file alone. Used where
 * no language server runs (SSH, WSL, remote runtimes) or when the server failed.
 */
async function inFileLocations(
  monaco: MonacoApi,
  feature: CodeNavigationFeature,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): Promise<Monaco.languages.Location[] | undefined> {
  const language = model.getLanguageId()
  if (feature === 'implementation' || (language !== 'typescript' && language !== 'javascript')) {
    return undefined
  }
  const getWorker =
    language === 'typescript'
      ? await monaco.typescript.getTypeScriptWorker()
      : await monaco.typescript.getJavaScriptWorker()
  const worker = await getWorker(model.uri)
  const resource = model.uri.toString()
  const offset = model.getOffsetAt(position)
  const entries =
    feature === 'definition'
      ? await worker.getDefinitionAtPosition(resource, offset)
      : await worker.getReferencesAtPosition(resource, offset)
  if (!entries || model.isDisposed()) {
    return undefined
  }
  return entries
    .filter(isTextSpanEntry)
    .filter((entry) => entry.fileName === resource)
    .map((entry) => {
      const start = model.getPositionAt(entry.textSpan.start)
      const end = model.getPositionAt(entry.textSpan.start + entry.textSpan.length)
      return {
        uri: model.uri,
        range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
      }
    })
}

function toMonacoRange(monaco: MonacoApi, range: CodeNavigationRange): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  )
}

async function provideLocations(
  monaco: MonacoApi,
  feature: CodeNavigationFeature,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token: Monaco.CancellationToken
): Promise<Monaco.languages.Location[] | undefined> {
  const api = window.api?.codeNavigation
  const context = resolveCodeNavigationContext(useAppStore.getState(), model.uri.toString())
  if (!api || !context || model.getValueLength() > MAX_SYNCED_DOCUMENT_CHARS) {
    return inFileLocations(monaco, feature, model, position)
  }
  const document = {
    path: context.tab.filePath,
    languageId: context.languageId,
    version: model.getVersionId(),
    text: model.getValue()
  }
  rememberSyncedDocument(model.uri.toString(), {
    kind: context.kind,
    root: context.root,
    path: document.path
  })
  const result = await api.query({
    kind: context.kind,
    root: context.root,
    feature,
    document,
    position: { line: position.lineNumber - 1, character: position.column - 1 }
  })
  if (token.isCancellationRequested || model.isDisposed()) {
    return undefined
  }
  if (!result.ok) {
    return inFileLocations(monaco, feature, model, position)
  }
  sweepIdlePreviewModels(monaco)
  return result.locations.map((location) => ({
    uri: navigationUriForPath(monaco, location.path, result.previews[location.path]),
    range: toMonacoRange(monaco, location.range)
  }))
}

/**
 * Routes definition, reference and implementation lookups to a language server. Monaco's built-in
 * TS providers are turned off for these features: Monaco merges every provider's results, and the
 * worker's guesses (an import line as the "definition") would sit next to the real answer.
 */
export function registerCodeNavigationProviders(monaco: MonacoApi): Monaco.IDisposable[] {
  for (const defaults of [
    monaco.typescript.typescriptDefaults,
    monaco.typescript.javascriptDefaults
  ]) {
    defaults.setModeConfiguration({
      ...defaults.modeConfiguration,
      definitions: false,
      references: false
    })
  }
  return CODE_NAVIGATION_MONACO_LANGUAGES.flatMap((language) => [
    monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: (model, position, token) =>
        provideLocations(monaco, 'definition', model, position, token)
    }),
    monaco.languages.registerReferenceProvider(language, {
      provideReferences: (model, position, _context, token) =>
        provideLocations(monaco, 'references', model, position, token)
    }),
    monaco.languages.registerImplementationProvider(language, {
      provideImplementation: (model, position, token) =>
        provideLocations(monaco, 'implementation', model, position, token)
    })
  ])
}
