import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('python')
})

describe('python outline', () => {
  const source = [
    'import os',
    'MAX_SIZE = 10',
    'counter = 0',
    '',
    '@dataclass',
    'class Point(Base):',
    '    x: int = 0',
    '    def __init__(self, x):',
    '        self.x = x',
    '    async def move(self, dx: int) -> None:',
    '        def clamp(v):',
    '            return v',
    '',
    'def main(argv=None):',
    '    pass'
  ].join('\n')

  it('nests methods under classes and keeps module-level names', () => {
    expect(shape(outline(source))).toEqual([
      { name: 'MAX_SIZE', kind: 'constant' },
      { name: 'counter', kind: 'variable' },
      {
        name: 'Point',
        kind: 'class',
        children: [
          { name: 'x', kind: 'field' },
          { name: '__init__', kind: 'constructor' },
          { name: 'move', kind: 'method', children: [{ name: 'clamp', kind: 'function' }] }
        ]
      },
      { name: 'main', kind: 'function' }
    ])
  })

  it('spans the decorator and points at the name', () => {
    const point = outline(source)[2]
    expect(point).toMatchObject({ line: 6, column: 7, startLine: 5, endLine: 12 })
  })

  it('shows parameters as detail', () => {
    expect(outline(source)[3].detail).toBe('(argv=None)')
  })
})
