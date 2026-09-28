import { diffArrays } from 'diff'

export type ChangeMarkerKind = 'added' | 'modified' | 'deleted'

/**
 * One contiguous change between the HEAD text and the editor buffer, in the
 * buffer's 1-based line numbers. A 'deleted' hunk covers no buffer lines:
 * `endLine === startLine - 1`, and the lines were removed after `endLine`.
 */
export type ChangeMarkerHunk = {
  kind: ChangeMarkerKind
  startLine: number
  endLine: number
  originalStartLine: number
  originalLines: readonly string[]
}

// Why: bounds Myers' O((N+M)·D) cost on a buffer that no longer resembles HEAD.
const MAX_EDIT_LENGTH = 4000

/** Splits like a Monaco model, so line N here is model line N + 1. */
export function splitChangeMarkerLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/** Lines of the HEAD text; an empty file has none, so a new file reads as all-added. */
export function splitChangeMarkerBaseline(text: string): string[] {
  return text.length === 0 ? [] : splitChangeMarkerLines(text)
}

/** Returns null when the texts differ too much to diff cheaply. */
export function computeChangeMarkerHunks(
  originalLines: readonly string[],
  currentLines: readonly string[]
): ChangeMarkerHunk[] | null {
  const sharedLength = Math.min(originalLines.length, currentLines.length)
  let prefix = 0
  while (prefix < sharedLength && originalLines[prefix] === currentLines[prefix]) {
    prefix++
  }
  let suffix = 0
  while (
    suffix < sharedLength - prefix &&
    originalLines[originalLines.length - 1 - suffix] ===
      currentLines[currentLines.length - 1 - suffix]
  ) {
    suffix++
  }
  const originalMiddle = originalLines.slice(prefix, originalLines.length - suffix)
  const currentMiddle = currentLines.slice(prefix, currentLines.length - suffix)
  if (originalMiddle.length === 0 && currentMiddle.length === 0) {
    return []
  }
  const changes = diffArrays(originalMiddle, currentMiddle, { maxEditLength: MAX_EDIT_LENGTH })
  if (!changes) {
    return null
  }

  const hunks: ChangeMarkerHunk[] = []
  let originalLine = prefix + 1
  let currentLine = prefix + 1
  let hunkOriginalStart = originalLine
  let hunkCurrentStart = currentLine
  let removed: string[] = []
  let addedCount = 0
  const flush = (): void => {
    if (removed.length > 0 || addedCount > 0) {
      hunks.push({
        kind: removed.length === 0 ? 'added' : addedCount === 0 ? 'deleted' : 'modified',
        startLine: hunkCurrentStart,
        endLine: hunkCurrentStart + addedCount - 1,
        originalStartLine: hunkOriginalStart,
        originalLines: removed
      })
    }
    removed = []
    addedCount = 0
    hunkOriginalStart = originalLine
    hunkCurrentStart = currentLine
  }
  for (const change of changes) {
    if (change.removed) {
      removed.push(...change.value)
      originalLine += change.value.length
    } else if (change.added) {
      addedCount += change.value.length
      currentLine += change.value.length
    } else {
      flush()
      originalLine += change.value.length
      currentLine += change.value.length
      hunkOriginalStart = originalLine
      hunkCurrentStart = currentLine
    }
  }
  flush()
  return hunks
}

/** The buffer line whose gutter carries the hunk's marker. */
export function getChangeMarkerAnchorLine(hunk: ChangeMarkerHunk): number {
  return hunk.kind === 'deleted' ? Math.max(1, hunk.endLine) : hunk.startLine
}

export function findChangeMarkerHunkAtLine(
  hunks: readonly ChangeMarkerHunk[],
  line: number
): number {
  return hunks.findIndex((hunk) =>
    hunk.kind === 'deleted'
      ? getChangeMarkerAnchorLine(hunk) === line
      : line >= hunk.startLine && line <= hunk.endLine
  )
}

/** Index of the next (or previous) hunk from `line`, wrapping around the file. */
export function findAdjacentChangeMarkerHunk(
  hunks: readonly ChangeMarkerHunk[],
  line: number,
  direction: 'next' | 'previous'
): number {
  if (hunks.length === 0) {
    return -1
  }
  if (direction === 'next') {
    const index = hunks.findIndex((hunk) => getChangeMarkerAnchorLine(hunk) > line)
    return index === -1 ? 0 : index
  }
  for (let index = hunks.length - 1; index >= 0; index--) {
    if (getChangeMarkerAnchorLine(hunks[index]) < line) {
      return index
    }
  }
  return hunks.length - 1
}
