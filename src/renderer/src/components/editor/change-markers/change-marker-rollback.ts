import type { IRange } from 'monaco-editor'
import type { ChangeMarkerHunk } from './change-marker-hunks'

export type ChangeMarkerModelShape = {
  lineCount: number
  getLineMaxColumn: (line: number) => number
  eol: string
}

export type ChangeMarkerEdit = { range: IRange; text: string }

function range(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number
): IRange {
  return { startLineNumber, startColumn, endLineNumber, endColumn }
}

/** The single edit that puts a hunk's HEAD lines back, including at end of file. */
export function buildChangeMarkerRollbackEdit(
  hunk: ChangeMarkerHunk,
  model: ChangeMarkerModelShape
): ChangeMarkerEdit {
  const { lineCount, getLineMaxColumn, eol } = model
  const linesWithTrailingEol = hunk.originalLines.map((line) => line + eol).join('')
  const linesWithLeadingEol = hunk.originalLines.map((line) => eol + line).join('')

  if (hunk.endLine < hunk.startLine) {
    const afterLine = hunk.endLine
    if (afterLine < lineCount) {
      return { range: range(afterLine + 1, 1, afterLine + 1, 1), text: linesWithTrailingEol }
    }
    const endColumn = getLineMaxColumn(afterLine)
    return { range: range(afterLine, endColumn, afterLine, endColumn), text: linesWithLeadingEol }
  }

  if (hunk.endLine < lineCount) {
    return { range: range(hunk.startLine, 1, hunk.endLine + 1, 1), text: linesWithTrailingEol }
  }
  // Why: the hunk reaches the last line, which has no line break to consume, so
  // take the break before the hunk instead.
  const endColumn = getLineMaxColumn(hunk.endLine)
  if (hunk.startLine > 1) {
    const previousLine = hunk.startLine - 1
    return {
      range: range(previousLine, getLineMaxColumn(previousLine), hunk.endLine, endColumn),
      text: linesWithLeadingEol
    }
  }
  return { range: range(1, 1, hunk.endLine, endColumn), text: hunk.originalLines.join(eol) }
}
