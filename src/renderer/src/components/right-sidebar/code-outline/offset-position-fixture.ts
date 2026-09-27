import type { OffsetToPosition } from './code-outline-types'

/** `model.getPositionAt` for plain text, so parsers can be tested without Monaco. */
export function offsetToPositionIn(text: string): OffsetToPosition {
  return (offset) => {
    const before = text.slice(0, offset).split('\n')
    return { lineNumber: before.length, column: (before.at(-1)?.length ?? 0) + 1 }
  }
}
