import type * as Monaco from 'monaco-editor'
import { useAppStore } from '@/store'
import type {
  CodeNavigationFeature,
  CodeNavigationHoverQuery,
  CodeNavigationRange
} from '../../../../shared/code-navigation/code-navigation-types'
import { CODE_NAVIGATION_MONACO_LANGUAGES } from './code-navigation-languages'
import { resolveCodeNavigationContext } from './code-navigation-workspace'
import { navigationUriForPath, sweepIdlePreviewModels } from './code-navigation-preview-models'
import { rememberSyncedDocument } from './code-navigation-document-lifecycle'
import { inFileHover, inFileLocations } from './code-navigation-ts-worker-fallback'

type MonacoApi = typeof Monaco

// Why: matches main's cap; bigger models keep Monaco's in-file navigation only.
const MAX_SYNCED_DOCUMENT_CHARS = 8 * 1024 * 1024

function toMonacoRange(monaco: MonacoApi, range: CodeNavigationRange): Monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  )
}

/** The server request for this model and position, or null when Monaco's own worker must answer. */
function serverRequestFor(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): CodeNavigationHoverQuery | null {
  const context = resolveCodeNavigationContext(useAppStore.getState(), model.uri.toString())
  if (!window.api?.codeNavigation || !context) {
    return null
  }
  if (model.getValueLength() > MAX_SYNCED_DOCUMENT_CHARS) {
    return null
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
  return {
    kind: context.kind,
    root: context.root,
    document,
    position: { line: position.lineNumber - 1, character: position.column - 1 }
  }
}

async function provideLocations(
  monaco: MonacoApi,
  feature: CodeNavigationFeature,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token: Monaco.CancellationToken
): Promise<Monaco.languages.Location[] | undefined> {
  const request = serverRequestFor(model, position)
  const api = window.api?.codeNavigation
  if (!request || !api) {
    return inFileLocations(monaco, feature, model, position)
  }
  const result = await api.query({ ...request, feature })
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

async function provideHover(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
  token: Monaco.CancellationToken
): Promise<Monaco.languages.Hover | undefined> {
  const request = serverRequestFor(model, position)
  const api = window.api?.codeNavigation
  if (!request || !api) {
    return inFileHover(monaco, model, position)
  }
  const result = await api.hover(request)
  if (token.isCancellationRequested || model.isDisposed()) {
    return undefined
  }
  // Why fall back: `ok: false` covers a server that is not installed yet or failed to start.
  if (!result.ok) {
    return inFileHover(monaco, model, position)
  }
  if (!result.hover) {
    return undefined
  }
  const { contents, range } = result.hover
  return {
    contents: contents.map((value) => ({ value })),
    ...(range ? { range: toMonacoRange(monaco, range) } : {})
  }
}

/**
 * Routes definition, type definition, reference, implementation and hover lookups to a language
 * server. Monaco's built-in TS providers are turned off for these features: Monaco merges every
 * provider's results, and the worker's guesses (an import line as the "definition", `any` for
 * imported types) would sit next to the real answer.
 */
export function registerCodeNavigationProviders(monaco: MonacoApi): Monaco.IDisposable[] {
  for (const defaults of [
    monaco.typescript.typescriptDefaults,
    monaco.typescript.javascriptDefaults
  ]) {
    defaults.setModeConfiguration({
      ...defaults.modeConfiguration,
      definitions: false,
      references: false,
      hovers: false
    })
  }
  return CODE_NAVIGATION_MONACO_LANGUAGES.flatMap((language) => [
    monaco.languages.registerDefinitionProvider(language, {
      provideDefinition: (model, position, token) =>
        provideLocations(monaco, 'definition', model, position, token)
    }),
    monaco.languages.registerTypeDefinitionProvider(language, {
      provideTypeDefinition: (model, position, token) =>
        provideLocations(monaco, 'typeDefinition', model, position, token)
    }),
    monaco.languages.registerReferenceProvider(language, {
      provideReferences: (model, position, _context, token) =>
        provideLocations(monaco, 'references', model, position, token)
    }),
    monaco.languages.registerImplementationProvider(language, {
      provideImplementation: (model, position, token) =>
        provideLocations(monaco, 'implementation', model, position, token)
    }),
    monaco.languages.registerHoverProvider(language, {
      provideHover: (model, position, token) => provideHover(monaco, model, position, token)
    })
  ])
}
