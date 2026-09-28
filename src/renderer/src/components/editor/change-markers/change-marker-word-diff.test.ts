import { describe, expect, it } from 'vitest'
import { computeChangeMarkerWordRanges } from './change-marker-word-diff'

describe('computeChangeMarkerWordRanges', () => {
  it('highlights only the changed word on each side', () => {
    expect(
      computeChangeMarkerWordRanges(['  "Articles": true,'], ['  "Articles": false,'])
    ).toEqual({
      original: [{ line: 0, startColumn: 15, endColumn: 19 }],
      current: [{ line: 0, startColumn: 15, endColumn: 20 }]
    })
  })

  it('tracks lines inside a multi-line hunk', () => {
    expect(computeChangeMarkerWordRanges(['a: 1', 'b: 2'], ['a: 1', 'b: 3'])).toEqual({
      original: [{ line: 1, startColumn: 4, endColumn: 5 }],
      current: [{ line: 1, startColumn: 4, endColumn: 5 }]
    })
  })

  it('skips blocks too large to highlight usefully', () => {
    const big = ['x'.repeat(15_000)]
    expect(computeChangeMarkerWordRanges(big, ['y'.repeat(15_000)])).toBeNull()
  })
})
