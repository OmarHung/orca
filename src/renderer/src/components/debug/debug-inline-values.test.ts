import { describe, expect, it } from 'vitest'
import { buildInlineValueHints } from './debug-inline-values'

const SOURCE = ['total = 0', 'for i in range(6):', '    total += i', 'print(total)']

function lineAt(line: number): string {
  return SOURCE[line - 1] ?? ''
}

const variables = [
  { name: 'total', value: '6', variablesReference: 0 },
  { name: 'i', value: '4', variablesReference: 0 },
  { name: 'special variables', value: '', variablesReference: 9 }
]

describe('buildInlineValueHints', () => {
  it('annotates each line up to the paused one with the locals it mentions', () => {
    expect(buildInlineValueHints(lineAt, 3, variables)).toEqual([
      { line: 1, text: 'total = 6' },
      { line: 2, text: 'i = 4' },
      { line: 3, text: 'total = 6, i = 4' }
    ])
  })

  it('matches whole names, not member access or substrings', () => {
    const hints = buildInlineValueHints(
      (line) => ['self.total = subtotal', 'totals = []'][line - 1] ?? '',
      2,
      variables
    )
    expect(hints).toEqual([])
  })

  it('shortens long values', () => {
    const [hint] = buildInlineValueHints(lineAt, 1, [
      { name: 'total', value: 'x'.repeat(80), variablesReference: 0 }
    ])
    expect(hint.text.length).toBeLessThanOrEqual('total = '.length + 40)
    expect(hint.text.endsWith('…')).toBe(true)
  })
})
