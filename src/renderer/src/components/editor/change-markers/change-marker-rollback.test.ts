import { describe, expect, it } from 'vitest'
import {
  computeChangeMarkerHunks,
  splitChangeMarkerBaseline,
  splitChangeMarkerLines
} from './change-marker-hunks'
import { buildChangeMarkerRollbackEdit, type ChangeMarkerEdit } from './change-marker-rollback'

function modelShape(text: string) {
  const lines = splitChangeMarkerLines(text)
  return {
    lineCount: lines.length,
    getLineMaxColumn: (line: number) => lines[line - 1].length + 1,
    eol: '\n'
  }
}

function applyEdit(text: string, edit: ChangeMarkerEdit): string {
  const lines = splitChangeMarkerLines(text)
  const offsetOf = (line: number, column: number): number =>
    lines.slice(0, line - 1).reduce((sum, content) => sum + content.length + 1, 0) + column - 1
  const start = offsetOf(edit.range.startLineNumber, edit.range.startColumn)
  const end = offsetOf(edit.range.endLineNumber, edit.range.endColumn)
  return text.slice(0, start) + edit.text + text.slice(end)
}

function rollbackAll(original: string, current: string): string {
  const hunks =
    computeChangeMarkerHunks(
      splitChangeMarkerBaseline(original),
      splitChangeMarkerLines(current)
    ) ?? []
  // Why: bottom-up keeps the earlier hunks' line numbers valid.
  return hunks
    .toReversed()
    .reduce(
      (text, hunk) => applyEdit(text, buildChangeMarkerRollbackEdit(hunk, modelShape(text))),
      current
    )
}

function rollbackFirst(original: string, current: string): string {
  const [hunk] =
    computeChangeMarkerHunks(
      splitChangeMarkerBaseline(original),
      splitChangeMarkerLines(current)
    ) ?? []
  return applyEdit(current, buildChangeMarkerRollbackEdit(hunk, modelShape(current)))
}

describe('buildChangeMarkerRollbackEdit', () => {
  it.each([
    ['a modified middle line', 'a\nb\nc', 'a\nB\nc'],
    ['an added middle line', 'a\nc', 'a\nb\nc'],
    ['a deleted middle line', 'a\nb\nc', 'a\nc'],
    ['a deleted first line', 'a\nb', 'b'],
    ['a deleted last line', 'a\nb\nc', 'a\nb'],
    ['an added last line', 'a\nb', 'a\nb\nc'],
    ['a modified last line', 'a\nb', 'a\nB'],
    ['a removed trailing newline', 'a\nb\n', 'a\nb'],
    ['an added trailing newline', 'a\nb', 'a\nb\n'],
    ['an emptied file', 'a\nb', ''],
    ['a new file', '', 'x\ny\n'],
    ['a whole-file rewrite', 'a\nb', 'x\ny\nz']
  ])('puts back %s', (_label, original, current) => {
    expect(rollbackFirst(original, current)).toBe(original)
  })

  it('restores the HEAD text when every hunk is rolled back', () => {
    const original = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', ''].join('\n')
    const current = ['zero', 'one', 'TWO', 'three', 'five', 'six', 'six-b', 'seven'].join('\n')

    expect(rollbackAll(original, current)).toBe(original)
  })

  it('only touches the rolled-back hunk', () => {
    const original = 'a\nb\nc\nd\ne'
    const current = 'A\nb\nc\nd\nE'

    expect(rollbackFirst(original, current)).toBe('a\nb\nc\nd\nE')
  })
})
