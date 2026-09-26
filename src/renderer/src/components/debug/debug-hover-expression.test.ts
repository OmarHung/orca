import { describe, expect, it } from 'vitest'
import { hoverExpressionAt } from './debug-hover-expression'

describe('hoverExpressionAt', () => {
  it('picks the identifier under the cursor', () => {
    expect(hoverExpressionAt('    total += i', 7)).toBe('total')
    expect(hoverExpressionAt('    total += i', 14)).toBe('i')
  })

  it('includes the member chain to the left', () => {
    expect(hoverExpressionAt('return self.config.port', 20)).toBe('self.config.port')
    expect(hoverExpressionAt('return self.config.port', 14)).toBe('self.config')
  })

  it('ignores punctuation, numbers and whitespace', () => {
    expect(hoverExpressionAt('x = (1 + 2)', 5)).toBeNull()
    expect(hoverExpressionAt('x = 42', 5)).toBeNull()
    expect(hoverExpressionAt('    ', 2)).toBeNull()
  })
})
