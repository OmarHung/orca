import { describe, expect, it } from 'vitest'
import { hoverExpressionAt, selectionHoverExpression } from './debug-hover-expression'

describe('hoverExpressionAt', () => {
  it('picks the identifier under the cursor', () => {
    expect(hoverExpressionAt('    total += i', 7)).toEqual({
      expression: 'total',
      startColumn: 5,
      endColumn: 10
    })
    expect(hoverExpressionAt('    total += i', 14)?.expression).toBe('i')
  })

  it('includes the member chain to the left', () => {
    expect(hoverExpressionAt('return self.config.port', 20)).toEqual({
      expression: 'self.config.port',
      startColumn: 8,
      endColumn: 24
    })
    expect(hoverExpressionAt('return self.config.port', 14)?.expression).toBe('self.config')
  })

  it('ignores punctuation, numbers and whitespace', () => {
    expect(hoverExpressionAt('x = (1 + 2)', 5)).toBeNull()
    expect(hoverExpressionAt('x = 42', 5)).toBeNull()
    expect(hoverExpressionAt('    ', 2)).toBeNull()
  })
})

describe('selectionHoverExpression', () => {
  it('evaluates the selected text as written', () => {
    expect(selectionHoverExpression('items[0].name', 9)).toEqual({
      expression: 'items[0].name',
      startColumn: 9,
      endColumn: 22
    })
  })

  it('ignores blank and multi-line selections', () => {
    expect(selectionHoverExpression('   ', 1)).toBeNull()
    expect(selectionHoverExpression('a +\nb', 1)).toBeNull()
  })
})
