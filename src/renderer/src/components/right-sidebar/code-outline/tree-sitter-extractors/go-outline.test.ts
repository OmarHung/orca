import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { findActiveSymbolPath } from '../code-outline-tree'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('go')
})

describe('go outline', () => {
  const source = [
    'package main',
    '',
    'const MaxSize = 10',
    'const (',
    '\tA = iota',
    '\tB',
    ')',
    'var counter, other int',
    '',
    'type Point struct {',
    '\tX, Y int',
    '\t*Base',
    '}',
    '',
    'type Shape interface {',
    '\tArea() float64',
    '}',
    '',
    'type ID = string',
    '',
    'func (p *Point) Move(dx int) {}',
    'func (l *List[T]) Push(v T) {}',
    'func main() {}'
  ].join('\n')

  it('nests fields and methods under their type', () => {
    expect(shape(outline(source))).toEqual([
      { name: 'MaxSize', kind: 'constant' },
      { name: 'A', kind: 'constant' },
      { name: 'B', kind: 'constant' },
      { name: 'counter', kind: 'variable' },
      { name: 'other', kind: 'variable' },
      {
        name: 'Point',
        kind: 'struct',
        children: [
          { name: 'X', kind: 'field' },
          { name: 'Y', kind: 'field' },
          { name: '*Base', kind: 'field' },
          { name: 'Move', kind: 'method' }
        ]
      },
      { name: 'Shape', kind: 'interface', children: [{ name: 'Area', kind: 'method' }] },
      { name: 'ID', kind: 'type' },
      { name: '(*List[T]).Push', kind: 'method' },
      { name: 'main', kind: 'function' }
    ])
  })

  it('gives each spec of a grouped declaration its own extent', () => {
    const [, a] = outline(source)
    expect(a).toMatchObject({ startLine: 5, endLine: 5 })
  })

  it('marks a method as current even though it sits outside its type', () => {
    expect(findActiveSymbolPath(outline(source), 21)).toEqual(['5', '5.3'])
  })

  it('shows parameters as detail', () => {
    const point = outline(source)[5]
    expect(point.children.at(-1)?.detail).toBe('(dx int)')
  })
})
