import { fileURLToPath } from 'node:url'
import type { CodeNavigationRange } from '../../shared/code-navigation/code-navigation-types'

/** A location as the server reported it, before Orca maps its URI to a file it can open. */
export type LspLocation = { uri: string; range: CodeNavigationRange }

type LspLocationLike = {
  uri?: unknown
  range?: unknown
  targetUri?: unknown
  targetSelectionRange?: unknown
}

function isPosition(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'line' in value &&
    typeof value.line === 'number' &&
    'character' in value &&
    typeof value.character === 'number'
  )
}

export function isLspRange(value: unknown): value is CodeNavigationRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    isPosition(value.start) &&
    'end' in value &&
    isPosition(value.end)
  )
}

function toLocation(entry: LspLocationLike): LspLocation | null {
  // Why the selection range for links: it is the symbol's name, not its whole declaration.
  const uri = entry.targetUri ?? entry.uri
  const range = entry.targetUri !== undefined ? entry.targetSelectionRange : entry.range
  if (typeof uri !== 'string' || !isLspRange(range)) {
    return null
  }
  return { uri, range: { start: { ...range.start }, end: { ...range.end } } }
}

/** Normalizes `Location | Location[] | LocationLink[] | null` to a list of locations. */
export function lspResultToLocations(result: unknown): LspLocation[] {
  const entries = Array.isArray(result) ? result : result ? [result] : []
  return entries
    .filter((entry): entry is LspLocationLike => typeof entry === 'object' && entry !== null)
    .map(toLocation)
    .filter((location): location is LspLocation => location !== null)
}

/** The local path of a `file:` URI, or null for any other scheme. */
export function filePathFromUri(uri: string): string | null {
  if (!uri.startsWith('file:')) {
    return null
  }
  try {
    return fileURLToPath(uri)
  } catch {
    return null
  }
}
