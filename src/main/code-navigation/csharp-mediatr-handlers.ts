import type {
  CodeNavigationDocument,
  CodeNavigationPosition
} from '../../shared/code-navigation/code-navigation-types'
import { filePathFromUri, lspResultToLocations, type LspLocation } from './lsp-locations'

/** What the MediatR lookup needs from a running server. */
export type MediatrSession = {
  query: (
    feature: 'definition' | 'implementation',
    document: CodeNavigationDocument,
    position: CodeNavigationPosition
  ) => Promise<LspLocation[]>
  request: (method: string, params: unknown) => Promise<unknown>
}

// The text right before a reference to the request type inside a handler's base list.
const HANDLER_INTERFACE_PREFIX =
  /\bI(?:Request|Notification|StreamRequest)Handler<\s*(?:[\w.]+\.)?$/
// The text right before the request type in the handler's `Handle(TRequest request, …)`.
const HANDLE_PARAMETER_PREFIX = /\bHandle\s*\(\s*(?:[\w.]+\.)?$/
const HANDLE_NAME = 'Handle'

function sameLocation(a: LspLocation, b: LspLocation): boolean {
  return (
    a.uri === b.uri &&
    a.range.start.line === b.range.start.line &&
    a.range.start.character === b.range.start.character
  )
}

function textBefore(lines: readonly string[], location: LspLocation): string {
  return (lines[location.range.start.line] ?? '').slice(0, location.range.start.character)
}

/** The handler's `Handle` method when it follows the base list in the same file, else the base list. */
function handlerTarget(
  handler: LspLocation,
  sameFile: readonly LspLocation[],
  lines: readonly string[]
): LspLocation {
  const handle = sameFile.find(
    (candidate) =>
      candidate.range.start.line >= handler.range.start.line &&
      HANDLE_PARAMETER_PREFIX.test(textBefore(lines, candidate))
  )
  if (!handle) {
    return handler
  }
  const character = textBefore(lines, handle).lastIndexOf(HANDLE_NAME)
  const start = { line: handle.range.start.line, character }
  return {
    uri: handle.uri,
    range: { start, end: { ...start, character: character + HANDLE_NAME.length } }
  }
}

async function handlersOfType(
  session: MediatrSession,
  declaration: LspLocation,
  readLines: (path: string) => Promise<string[] | null>
): Promise<LspLocation[]> {
  const references = lspResultToLocations(
    await session.request('textDocument/references', {
      textDocument: { uri: declaration.uri },
      position: declaration.range.start,
      context: { includeDeclaration: false }
    })
  )
  const byFile = new Map<string, LspLocation[]>()
  for (const reference of references) {
    byFile.set(reference.uri, [...(byFile.get(reference.uri) ?? []), reference])
  }
  const handlers: LspLocation[] = []
  for (const [uri, inFile] of byFile) {
    const path = filePathFromUri(uri)
    const lines = path ? await readLines(path) : null
    if (!lines) {
      continue
    }
    const sorted = [...inFile].sort((a, b) => a.range.start.line - b.range.start.line)
    const bases = sorted.filter((reference) =>
      HANDLER_INTERFACE_PREFIX.test(textBefore(lines, reference))
    )
    for (const [index, base] of bases.entries()) {
      // Why bounded by the next base list: each handler class gets its own Handle method.
      const nextBaseLine = bases[index + 1]?.range.start.line ?? Number.POSITIVE_INFINITY
      const own = sorted.filter((reference) => reference.range.start.line < nextBaseLine)
      handlers.push(handlerTarget(base, own, lines))
    }
  }
  return handlers
}

/**
 * Go to Implementation for C#, with MediatR in mind: on a request or notification type (whose
 * only "implementation" is itself) it lands on the handlers' `Handle` methods instead, like
 * Rider's MediatR plugin. The type is resolved through its declaration because a cursor inside
 * `new ListArticlesQuery(…)` names the constructor, whose references never include the handler.
 */
export async function csharpImplementations(
  session: MediatrSession,
  document: CodeNavigationDocument,
  position: CodeNavigationPosition,
  readLines: (path: string) => Promise<string[] | null>
): Promise<LspLocation[]> {
  const implementations = await session.query('implementation', document, position)
  const declaration = (await session.query('definition', document, position)).find(
    (location) => filePathFromUri(location.uri) !== null
  )
  const onlyItself = implementations.every(
    (location) => declaration !== undefined && sameLocation(location, declaration)
  )
  if (!declaration || !onlyItself) {
    return implementations
  }
  const handlers = await handlersOfType(session, declaration, readLines)
  return handlers.length > 0 ? handlers : implementations
}
