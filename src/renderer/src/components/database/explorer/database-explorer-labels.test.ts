import { describe, expect, it } from 'vitest'
import { commentLine } from './database-explorer-labels'

describe('commentLine', () => {
  it('puts a comment on one line, whatever breaks and runs of spaces it holds', () => {
    expect(commentLine('Given and family name\nas written')).toBe(
      'Given and family name as written'
    )
    expect(commentLine('  first\r\n\r\n\tsecond  ')).toBe('first second')
    expect(commentLine("Everyone we've met")).toBe("Everyone we've met")
  })
})
