import { describe, expect, it } from 'vitest'
import {
  computeChangeMarkerHunks,
  splitChangeMarkerBaseline,
  splitChangeMarkerLines
} from '../change-markers/change-marker-hunks'
import { mapBufferLineToBlamedLine } from './blame-line-mapping'

function hunks(blamed: string, buffer: string) {
  return (
    computeChangeMarkerHunks(splitChangeMarkerBaseline(blamed), splitChangeMarkerLines(buffer)) ??
    []
  )
}

describe('mapBufferLineToBlamedLine', () => {
  it('follows lines that moved because of edits above them', () => {
    const edited = hunks('a\nb\nc\nd\ne', 'new\na\nB\nc\ne')
    expect([1, 2, 3, 4, 5].map((line) => mapBufferLineToBlamedLine(edited, line))).toEqual([
      null,
      1,
      null,
      3,
      5
    ])
  })

  it('maps every line one-to-one when nothing changed', () => {
    expect(mapBufferLineToBlamedLine(hunks('a\nb', 'a\nb'), 2)).toBe(2)
  })
})
