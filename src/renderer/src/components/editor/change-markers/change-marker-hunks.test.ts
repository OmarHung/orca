import { describe, expect, it } from 'vitest'
import {
  computeChangeMarkerHunks,
  findAdjacentChangeMarkerHunk,
  findChangeMarkerHunkAtLine,
  getChangeMarkerAnchorLine,
  splitChangeMarkerBaseline,
  splitChangeMarkerLines
} from './change-marker-hunks'

function hunksBetween(original: string, current: string) {
  return computeChangeMarkerHunks(
    splitChangeMarkerBaseline(original),
    splitChangeMarkerLines(current)
  )
}

describe('computeChangeMarkerHunks', () => {
  it('returns no hunks for identical text', () => {
    expect(hunksBetween('a\nb\n', 'a\nb\n')).toEqual([])
  })

  it('reports added, modified and deleted lines in buffer line numbers', () => {
    const original = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n')
    const current = ['a', 'new', 'b', 'C', 'd', 'f'].join('\n')

    expect(hunksBetween(original, current)).toEqual([
      { kind: 'added', startLine: 2, endLine: 2, originalStartLine: 2, originalLines: [] },
      { kind: 'modified', startLine: 4, endLine: 4, originalStartLine: 3, originalLines: ['c'] },
      { kind: 'deleted', startLine: 6, endLine: 5, originalStartLine: 5, originalLines: ['e'] }
    ])
  })

  it('treats a new file as one added hunk', () => {
    expect(hunksBetween('', 'x\ny')).toEqual([
      { kind: 'added', startLine: 1, endLine: 2, originalStartLine: 1, originalLines: [] }
    ])
  })

  it('anchors a deletion at the top of the file to line 1', () => {
    const [hunk] = hunksBetween('gone\nkept', 'kept') ?? []
    expect(hunk).toEqual({
      kind: 'deleted',
      startLine: 1,
      endLine: 0,
      originalStartLine: 1,
      originalLines: ['gone']
    })
    expect(getChangeMarkerAnchorLine(hunk)).toBe(1)
  })

  it('sees a removed trailing newline as a deleted empty last line', () => {
    expect(hunksBetween('a\nb\n', 'a\nb')).toEqual([
      { kind: 'deleted', startLine: 3, endLine: 2, originalStartLine: 3, originalLines: [''] }
    ])
  })

  it('splits CRLF and LF text the same way', () => {
    expect(hunksBetween('a\r\nb\r\nc', 'a\nB\nc')).toEqual([
      { kind: 'modified', startLine: 2, endLine: 2, originalStartLine: 2, originalLines: ['b'] }
    ])
  })
})

describe('change marker hunk lookup', () => {
  const hunks =
    hunksBetween(
      ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n'),
      ['1', 'two', '3', '4', '6', '7', 'seven-and-a-half', '8'].join('\n')
    ) ?? []

  it('finds the hunk under a clicked line', () => {
    expect(hunks.map((hunk) => hunk.kind)).toEqual(['modified', 'deleted', 'added'])
    expect(findChangeMarkerHunkAtLine(hunks, 2)).toBe(0)
    expect(findChangeMarkerHunkAtLine(hunks, 4)).toBe(1)
    expect(findChangeMarkerHunkAtLine(hunks, 7)).toBe(2)
    expect(findChangeMarkerHunkAtLine(hunks, 5)).toBe(-1)
  })

  it('steps to the next and previous hunk, wrapping at the ends', () => {
    expect(findAdjacentChangeMarkerHunk(hunks, 1, 'next')).toBe(0)
    expect(findAdjacentChangeMarkerHunk(hunks, 2, 'next')).toBe(1)
    expect(findAdjacentChangeMarkerHunk(hunks, 7, 'next')).toBe(0)
    expect(findAdjacentChangeMarkerHunk(hunks, 7, 'previous')).toBe(1)
    expect(findAdjacentChangeMarkerHunk(hunks, 2, 'previous')).toBe(2)
    expect(findAdjacentChangeMarkerHunk([], 2, 'next')).toBe(-1)
  })
})
