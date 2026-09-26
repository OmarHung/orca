import { describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from './code-outline-types'
import { findActiveSymbolPath, flattenCodeOutline } from './code-outline-tree'

function symbol(
  name: string,
  startLine: number,
  endLine: number,
  children: CodeOutlineSymbol[] = []
): CodeOutlineSymbol {
  return { name, kind: 'class', line: startLine, column: 1, startLine, endLine, children }
}

const symbols = [
  symbol('Alpha', 1, 10, [symbol('first', 2, 4), symbol('second', 5, 9)]),
  symbol('Beta', 12, 20, [symbol('gamma', 13, 15)])
]

describe('findActiveSymbolPath', () => {
  it('returns the chain down to the innermost symbol containing the line', () => {
    expect(findActiveSymbolPath(symbols, 6)).toEqual(['0', '0.1'])
  })

  it('stops at the parent when the line is between children', () => {
    expect(findActiveSymbolPath(symbols, 16)).toEqual(['1'])
  })

  it('is empty outside every symbol', () => {
    expect(findActiveSymbolPath(symbols, 11)).toEqual([])
  })
})

describe('flattenCodeOutline', () => {
  it('expands everything by default', () => {
    expect(flattenCodeOutline(symbols, new Set(), '').map((row) => row.symbol.name)).toEqual([
      'Alpha',
      'first',
      'second',
      'Beta',
      'gamma'
    ])
  })

  it('hides children of collapsed symbols', () => {
    const rows = flattenCodeOutline(symbols, new Set(['0']), '')
    expect(rows.map((row) => [row.symbol.name, row.isExpanded])).toEqual([
      ['Alpha', false],
      ['Beta', true],
      ['gamma', false]
    ])
  })

  it('shows filter matches with their ancestors, ignoring collapse state', () => {
    const rows = flattenCodeOutline(symbols, new Set(['1']), 'GAM')
    expect(rows.map((row) => [row.symbol.name, row.depth])).toEqual([
      ['Beta', 0],
      ['gamma', 1]
    ])
  })
})
