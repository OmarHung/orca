import { diffWordsWithSpace } from 'diff'

/** A changed span on one line of a hunk; `line` is 0-based within the hunk, columns 1-based. */
export type ChangeMarkerWordRange = {
  line: number
  startColumn: number
  endColumn: number
}

export type ChangeMarkerWordRanges = {
  original: ChangeMarkerWordRange[]
  current: ChangeMarkerWordRange[]
}

// Why: word diffs of big blocks are slow and read as noise, not as a highlight.
const MAX_WORD_DIFF_CHARACTERS = 20_000

type Cursor = { line: number; column: number }

function advance(cursor: Cursor, text: string, out: ChangeMarkerWordRange[] | null): void {
  const segments = text.split('\n')
  segments.forEach((segment, index) => {
    if (index > 0) {
      cursor.line++
      cursor.column = 1
    }
    if (segment.length > 0) {
      out?.push({
        line: cursor.line,
        startColumn: cursor.column,
        endColumn: cursor.column + segment.length
      })
      cursor.column += segment.length
    }
  })
}

/** Word-level changes between the lines a 'modified' hunk replaced and the lines now there. */
export function computeChangeMarkerWordRanges(
  originalLines: readonly string[],
  currentLines: readonly string[]
): ChangeMarkerWordRanges | null {
  const originalText = originalLines.join('\n')
  const currentText = currentLines.join('\n')
  if (originalText.length + currentText.length > MAX_WORD_DIFF_CHARACTERS) {
    return null
  }
  const parts = diffWordsWithSpace(originalText, currentText)
  const result: ChangeMarkerWordRanges = { original: [], current: [] }
  const originalCursor: Cursor = { line: 0, column: 1 }
  const currentCursor: Cursor = { line: 0, column: 1 }
  for (const part of parts) {
    if (part.removed) {
      advance(originalCursor, part.value, result.original)
    } else if (part.added) {
      advance(currentCursor, part.value, result.current)
    } else {
      advance(originalCursor, part.value, null)
      advance(currentCursor, part.value, null)
    }
  }
  return result
}
