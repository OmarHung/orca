import { describe, expect, it } from 'vitest'
import { lspHoverToCodeNavigationHover } from './lsp-hover'

describe('lspHoverToCodeNavigationHover', () => {
  it('keeps Markdown content and the hovered range', () => {
    const range = { start: { line: 1, character: 0 }, end: { line: 1, character: 7 } }
    expect(
      lspHoverToCodeNavigationHover({ contents: { kind: 'markdown', value: '**bold**' }, range })
    ).toEqual({ contents: ['**bold**'], range })
  })

  it('fences plain text and language-tagged MarkedStrings', () => {
    expect(
      lspHoverToCodeNavigationHover({
        contents: [
          { kind: 'plaintext', value: 'var a: *b*' },
          { language: 'csharp', value: 'int Count' },
          'Some *docs*'
        ]
      })
    ).toEqual({
      contents: ['```text\nvar a: *b*\n```', '```csharp\nint Count\n```', 'Some *docs*']
    })
  })

  it('returns null when there is nothing to show', () => {
    expect(lspHoverToCodeNavigationHover(null)).toBeNull()
    expect(lspHoverToCodeNavigationHover({ contents: '' })).toBeNull()
    expect(lspHoverToCodeNavigationHover({ contents: [{ nope: 1 }] })).toBeNull()
  })
})
