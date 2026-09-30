import { fileURLToPath } from 'node:url'
import type {
  CodeNavigationLocation,
  CodeNavigationRange
} from '../../shared/code-navigation/code-navigation-types'

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

function isRange(value: unknown): value is CodeNavigationRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    'start' in value &&
    isPosition(value.start) &&
    'end' in value &&
    isPosition(value.end)
  )
}

function filePathFromUri(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith('file:')) {
    return null
  }
  try {
    return fileURLToPath(uri)
  } catch {
    return null
  }
}

function toLocation(entry: LspLocationLike): CodeNavigationLocation | null {
  // Why the selection range for links: it is the symbol's name, not its whole declaration.
  const path = filePathFromUri(entry.targetUri ?? entry.uri)
  const range = entry.targetUri !== undefined ? entry.targetSelectionRange : entry.range
  if (!path || !isRange(range)) {
    return null
  }
  return { path, range: { start: { ...range.start }, end: { ...range.end } } }
}

/**
 * Normalizes `Location | Location[] | LocationLink[] | null` to file locations. Non-file URIs
 * (decompiled metadata, bundled libs) are dropped: nothing in Orca can open them yet.
 */
export function lspResultToLocations(result: unknown): CodeNavigationLocation[] {
  const entries = Array.isArray(result) ? result : result ? [result] : []
  return entries
    .filter((entry): entry is LspLocationLike => typeof entry === 'object' && entry !== null)
    .map(toLocation)
    .filter((location): location is CodeNavigationLocation => location !== null)
}
