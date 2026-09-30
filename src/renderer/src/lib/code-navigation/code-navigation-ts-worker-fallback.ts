import type * as Monaco from 'monaco-editor'
import type { CodeNavigationFeature } from '../../../../shared/code-navigation/code-navigation-types'

type MonacoApi = typeof Monaco
type TextSpan = { start: number; length: number }
type TextSpanEntry = { fileName: string; textSpan: TextSpan }
type DisplayPart = { text: string }
type QuickInfo = {
  textSpan: TextSpan
  displayParts?: unknown
  documentation?: unknown
  tags?: unknown
}

function isTextSpan(value: unknown): value is TextSpan {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    typeof value.start === 'number' &&
    'length' in value &&
    typeof value.length === 'number'
  )
}

function isTextSpanEntry(value: unknown): value is TextSpanEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fileName' in value &&
    typeof value.fileName === 'string' &&
    'textSpan' in value &&
    isTextSpan(value.textSpan)
  )
}

function isQuickInfo(value: unknown): value is QuickInfo {
  return (
    typeof value === 'object' && value !== null && 'textSpan' in value && isTextSpan(value.textSpan)
  )
}

function isDisplayPart(value: unknown): value is DisplayPart {
  return (
    typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string'
  )
}

function displayText(parts: unknown): string {
  return Array.isArray(parts)
    ? parts
        .filter(isDisplayPart)
        .map((part) => part.text)
        .join('')
    : ''
}

/** JSDoc tags the way Monaco's built-in hover prints them. */
function tagText(tag: unknown): string | null {
  if (typeof tag !== 'object' || tag === null || !('name' in tag) || typeof tag.name !== 'string') {
    return null
  }
  const text = 'text' in tag ? tag.text : undefined
  const label = `*@${tag.name}*`
  if (tag.name === 'param' && Array.isArray(text) && text.length > 0) {
    const [name, ...rest] = text.filter(isDisplayPart)
    const description = rest.map((part) => part.text).join(' ')
    return `${label}\`${name?.text ?? ''}\`${description ? ` — ${description}` : ''}`
  }
  const body = Array.isArray(text) ? displayText(text) : typeof text === 'string' ? text : ''
  return body ? `${label} — ${body}` : label
}

async function workerFor(monaco: MonacoApi, model: Monaco.editor.ITextModel) {
  const language = model.getLanguageId()
  if (language !== 'typescript' && language !== 'javascript') {
    return null
  }
  const getWorker =
    language === 'typescript'
      ? await monaco.typescript.getTypeScriptWorker()
      : await monaco.typescript.getJavaScriptWorker()
  return getWorker(model.uri)
}

function spanToRange(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  span: TextSpan
): Monaco.Range {
  const start = model.getPositionAt(span.start)
  const end = model.getPositionAt(span.start + span.length)
  return new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
}

/**
 * Monaco's own TS worker only sees open models, so it can answer for this file alone. Used where
 * no language server runs (SSH, WSL, remote runtimes) or when the server failed.
 */
export async function inFileLocations(
  monaco: MonacoApi,
  feature: CodeNavigationFeature,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): Promise<Monaco.languages.Location[] | undefined> {
  if (feature !== 'definition' && feature !== 'references') {
    return undefined
  }
  const worker = await workerFor(monaco, model)
  if (!worker) {
    return undefined
  }
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
    .map((entry) => ({ uri: model.uri, range: spanToRange(monaco, model, entry.textSpan) }))
}

/** Monaco's built-in TS hover, for models no language server handles. */
export async function inFileHover(
  monaco: MonacoApi,
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): Promise<Monaco.languages.Hover | undefined> {
  const worker = await workerFor(monaco, model)
  if (!worker) {
    return undefined
  }
  const info: unknown = await worker.getQuickInfoAtPosition(
    model.uri.toString(),
    model.getOffsetAt(position)
  )
  if (!isQuickInfo(info) || model.isDisposed()) {
    return undefined
  }
  const tags = Array.isArray(info.tags)
    ? info.tags.map(tagText).filter((tag): tag is string => tag !== null)
    : []
  const documentation = displayText(info.documentation)
  return {
    range: spanToRange(monaco, model, info.textSpan),
    contents: [
      { value: `\`\`\`typescript\n${displayText(info.displayParts)}\n\`\`\`\n` },
      { value: [documentation, tags.join('  \n\n')].filter(Boolean).join('\n\n') }
    ]
  }
}
