import { describe, expect, it } from 'vitest'
import { readBufferCursorLine } from './terminal-pane-manager-registry'

type FakeRow = { text: string; isWrapped: boolean }

function readCursorLine(rows: FakeRow[]): string {
  return readBufferCursorLine({
    baseY: 0,
    cursorY: rows.length - 1,
    getLine: (row) => {
      const line = rows[row]
      return (
        line && {
          isWrapped: line.isWrapped,
          translateToString: (trimRight) => (trimRight ? line.text.trimEnd() : line.text)
        }
      )
    }
  })
}

describe('readBufferCursorLine', () => {
  it('joins a line that wrapped onto the row the cursor is on', () => {
    const line = readCursorLine([
      { text: 'older output   ', isWrapped: false },
      { text: "deploy@a-very-long-host-name's pass", isWrapped: false },
      { text: 'word:   ', isWrapped: true }
    ])

    expect(line).toBe("deploy@a-very-long-host-name's password:")
  })

  it('stops at the start of the line', () => {
    const line = readCursorLine([
      { text: 'Password: ', isWrapped: false },
      { text: '$ ', isWrapped: false }
    ])

    expect(line).toBe('$')
  })
})
