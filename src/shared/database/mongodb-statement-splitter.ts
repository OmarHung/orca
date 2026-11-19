import type { SqlStatementRange } from './sql-statement-splitter'

/**
 * Splits a MongoDB console the way mongosh reads it: a statement ends at `;`, or at a line
 * break outside brackets unless the next line continues it with `.method(…)`. Strings,
 * template literals, comments and regex literals are skipped.
 */

// A `/` after one of these (or at the start) opens a regex literal, not a division.
const REGEX_PRECEDERS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';'])

function quotedEnd(text: string, start: number): number {
  const quote = text[start]
  let index = start + 1
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2
      continue
    }
    if (text[index] === quote) {
      return index + 1
    }
    index += 1
  }
  return text.length
}

function regexEnd(text: string, start: number): number {
  let index = start + 1
  let inClass = false
  while (index < text.length && text[index] !== '\n') {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '[') {
      inClass = true
    } else if (char === ']') {
      inClass = false
    } else if (char === '/' && !inClass) {
      index += 1
      while (index < text.length && /[a-z]/i.test(text[index])) {
        index += 1
      }
      return index
    }
    index += 1
  }
  return index
}

/** Where the comment at `index` ends, or null when none starts there. */
function commentEnd(text: string, index: number): number | null {
  if (text[index] !== '/') {
    return null
  }
  if (text[index + 1] === '/') {
    const newline = text.indexOf('\n', index)
    return newline === -1 ? text.length : newline
  }
  if (text[index + 1] === '*') {
    const close = text.indexOf('*/', index + 2)
    return close === -1 ? text.length : close + 2
  }
  return null
}

/** The next character that is not whitespace or a comment, from `index`. */
function nextSignificant(text: string, index: number): string | undefined {
  let cursor = index
  while (cursor < text.length) {
    if (/\s/.test(text[cursor])) {
      cursor += 1
      continue
    }
    const end = commentEnd(text, cursor)
    if (end === null) {
      return text[cursor]
    }
    cursor = end
  }
  return undefined
}

export function splitMongoStatements(text: string): SqlStatementRange[] {
  const statements: SqlStatementRange[] = []
  let start: number | null = null
  let lastEnd = 0
  let depth = 0
  let previous: string | undefined

  const finish = (terminatorEnd: number): void => {
    if (start !== null) {
      statements.push({ start, end: lastEnd, terminatorEnd, text: text.slice(start, lastEnd) })
    }
    start = null
    depth = 0
    previous = undefined
  }

  let index = 0
  while (index < text.length) {
    const char = text[index]
    const comment = commentEnd(text, index)
    if (comment !== null) {
      index = comment
      continue
    }
    if (char === '\n' && depth === 0 && start !== null && nextSignificant(text, index) !== '.') {
      finish(lastEnd)
      index += 1
      continue
    }
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === ';' && depth === 0) {
      finish(index + 1)
      index += 1
      continue
    }
    start ??= index
    let next = index + 1
    if (char === '"' || char === "'" || char === '`') {
      next = quotedEnd(text, index)
    } else if (char === '/' && (previous === undefined || REGEX_PRECEDERS.has(previous))) {
      next = regexEnd(text, index)
    } else if (char === '(' || char === '[' || char === '{') {
      depth += 1
    } else if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1)
    }
    previous = char
    lastEnd = next
    index = next
  }
  finish(lastEnd)
  return statements
}
