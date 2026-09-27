import { beforeAll, describe, expect, it } from 'vitest'
import type { CodeOutlineSymbol } from '../code-outline-types'
import { loadOutliner, outlineShape as shape } from './outline-test-parser'

let outline: (source: string) => CodeOutlineSymbol[]

beforeAll(async () => {
  outline = await loadOutliner('css')
})

describe('css outline', () => {
  it('outlines rule sets and block at-rules, including nesting', () => {
    const source = `@import url("base.css");
:root { --accent: red; }
.btn,
.btn-primary > a:hover { color: var(--accent); }
@media (max-width: 600px) {
  .btn { padding: 0; }
  @supports (display: grid) { .grid { display: grid; } }
}
@keyframes spin { from { opacity: 0; } to { opacity: 1; } }
.card { .title { color: blue; } &:hover { color: red; } }`
    expect(shape(outline(source))).toEqual([
      { name: ':root', kind: 'class' },
      { name: '.btn, .btn-primary > a:hover', kind: 'class' },
      {
        name: '@media (max-width: 600px)',
        kind: 'namespace',
        children: [
          { name: '.btn', kind: 'class' },
          {
            name: '@supports (display: grid)',
            kind: 'namespace',
            children: [{ name: '.grid', kind: 'class' }]
          }
        ]
      },
      { name: '@keyframes spin', kind: 'namespace' },
      {
        name: '.card',
        kind: 'class',
        children: [
          { name: '.title', kind: 'class' },
          { name: '&:hover', kind: 'class' }
        ]
      }
    ])
  })

  it('spans the rule set and points at its selectors', () => {
    const [rule] = outline('\n  .a {\n  color: red;\n}\n')
    expect(rule).toMatchObject({ line: 2, column: 3, startLine: 2, endLine: 4 })
  })
})
