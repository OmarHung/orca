import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('powershell')
})

describe('powershell outline', () => {
  const source = `param([string]$Name)

function Get-Thing {
    param($Id)
    function Inner { }
}

filter Select-Even { $_ }

class Point : Base {
    [int]$X
    static [string]$Label = "p"
    Point([int]$x) { $this.X = $x }
    [double] Area([int]$scale) { return 0 }
}

enum Color { Red; Green = 2 }`

  it('outlines functions, classes and enums', () => {
    expect(shape(outline(source))).toEqual([
      { name: 'Get-Thing', kind: 'function', children: [{ name: 'Inner', kind: 'function' }] },
      { name: 'Select-Even', kind: 'function' },
      {
        name: 'Point',
        kind: 'class',
        children: [
          { name: 'X', kind: 'property' },
          { name: 'Label', kind: 'property' },
          { name: 'Point', kind: 'constructor' },
          { name: 'Area', kind: 'method' }
        ]
      },
      {
        name: 'Color',
        kind: 'enum',
        children: [
          { name: 'Red', kind: 'enum-member' },
          { name: 'Green', kind: 'enum-member' }
        ]
      }
    ])
  })

  it('shows method parameters as detail', () => {
    const point = outline(source)[2]
    expect(point.children.map((member) => member.detail)).toEqual([
      undefined,
      undefined,
      '([int]$x)',
      '([int]$scale)'
    ])
  })
})
