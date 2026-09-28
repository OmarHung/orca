import * as monaco from 'monaco-editor'
import type { editor, IRange } from 'monaco-editor'
import {
  getChangeMarkerAnchorLine,
  type ChangeMarkerHunk,
  type ChangeMarkerKind
} from './change-marker-hunks'
import type { ChangeMarkerWordRange } from './change-marker-word-diff'

export type ChangeMarkerColors = Record<ChangeMarkerKind, string>

export function wholeLines(start: number, end: number): IRange {
  return { startLineNumber: start, startColumn: 1, endLineNumber: end, endColumn: 1 }
}

/** Buffer lines a hunk's marker covers; a deletion marks the line above the gap. */
export function hunkLineSpan(hunk: ChangeMarkerHunk): { start: number; end: number } {
  if (hunk.kind === 'deleted') {
    const anchor = getChangeMarkerAnchorLine(hunk)
    return { start: anchor, end: anchor }
  }
  return { start: hunk.startLine, end: hunk.endLine }
}

// Why: the overview ruler paints on a canvas, which can't read CSS variables.
export function readChangeMarkerColors(element: HTMLElement): ChangeMarkerColors {
  const style = getComputedStyle(element)
  const color = (kind: ChangeMarkerKind): string =>
    style.getPropertyValue(`--git-decoration-${kind}`).trim()
  return { added: color('added'), modified: color('modified'), deleted: color('deleted') }
}

export function buildChangeMarkerGutterDecorations(
  hunks: readonly ChangeMarkerHunk[],
  colors: ChangeMarkerColors,
  tooltip: string
): editor.IModelDeltaDecoration[] {
  return hunks.map((hunk) => {
    const span = hunkLineSpan(hunk)
    const atTop = hunk.kind === 'deleted' && hunk.endLine === 0
    return {
      range: wholeLines(span.start, span.end),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `orca-change-marker orca-change-marker-${hunk.kind}${
          atTop ? ' orca-change-marker-deleted-top' : ''
        }`,
        linesDecorationsTooltip: tooltip,
        overviewRuler: {
          color: colors[hunk.kind],
          position: monaco.editor.OverviewRulerLane.Left
        },
        minimap: { color: colors[hunk.kind], position: monaco.editor.MinimapPosition.Gutter },
        stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
      }
    }
  })
}

/** Green wash (and word highlights) on the buffer lines of the open hunk. */
export function buildChangeMarkerCurrentHighlight(
  hunk: ChangeMarkerHunk,
  wordRanges: readonly ChangeMarkerWordRange[]
): editor.IModelDeltaDecoration[] {
  if (hunk.kind === 'deleted') {
    return []
  }
  const lines: editor.IModelDeltaDecoration = {
    range: wholeLines(hunk.startLine, hunk.endLine),
    options: {
      isWholeLine: true,
      className: 'orca-change-marker-current-line',
      marginClassName: 'orca-change-marker-current-margin'
    }
  }
  const words = wordRanges.map((range) => ({
    range: {
      startLineNumber: hunk.startLine + range.line,
      startColumn: range.startColumn,
      endLineNumber: hunk.startLine + range.line,
      endColumn: range.endColumn
    },
    options: { inlineClassName: 'orca-change-marker-current-text' }
  }))
  return [lines, ...words]
}
