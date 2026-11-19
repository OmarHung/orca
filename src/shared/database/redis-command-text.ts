import type { SqlStatementRange } from './sql-statement-splitter'

/**
 * redis-cli's console syntax: one command per line, words split on spaces, `"…"` with
 * backslash escapes and `'…'` with only `\'`. A quote may run onto the next line, and lines
 * starting with `#` or `//` are comments.
 */

const COMMENT_LINE = /^[ \t]*(?:#|\/\/)/

type Scan = { end: number; unterminated: boolean }

/** Where the quoted word starting at `start` (on its quote) ends, just past the closing quote. */
function quotedEnd(text: string, start: number): Scan {
  const quote = text[start]
  let index = start + 1
  while (index < text.length) {
    const char = text[index]
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === quote) {
      return { end: index + 1, unterminated: false }
    }
    index += 1
  }
  return { end: text.length, unterminated: true }
}

function lineEnd(text: string, from: number): number {
  const newline = text.indexOf('\n', from)
  return newline === -1 ? text.length : newline
}

/** Each command in the console, with offsets into `text`. */
export function splitRedisCommands(text: string): SqlStatementRange[] {
  const commands: SqlStatementRange[] = []
  let lineStart = 0
  while (lineStart < text.length) {
    const end = lineEnd(text, lineStart)
    if (COMMENT_LINE.test(text.slice(lineStart, end))) {
      lineStart = end + 1
      continue
    }
    let index = lineStart
    let commandEnd = end
    while (index < commandEnd) {
      const char = text[index]
      if (char === '"' || char === "'") {
        index = quotedEnd(text, index).end
        commandEnd = Math.max(commandEnd, lineEnd(text, index))
        continue
      }
      index += 1
    }
    const raw = text.slice(lineStart, commandEnd)
    const leading = raw.length - raw.trimStart().length
    const body = raw.trim()
    if (body) {
      const start = lineStart + leading
      commands.push({
        start,
        end: start + body.length,
        terminatorEnd: start + body.length,
        text: body
      })
    }
    lineStart = commandEnd + 1
  }
  return commands
}

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', a: '\u0007' }

function unquoteDouble(body: string): string {
  let out = ''
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char !== '\\' || index + 1 >= body.length) {
      out += char
      continue
    }
    const next = body[index + 1]
    const hex = /^x([0-9a-fA-F]{2})/.exec(body.slice(index + 1))
    if (hex) {
      out += String.fromCharCode(Number.parseInt(hex[1], 16))
      index += 3
      continue
    }
    out += ESCAPES[next] ?? next
    index += 1
  }
  return out
}

/** A command's words as redis-cli sends them; throws on an unterminated quote. */
export function parseRedisCommandWords(command: string): string[] {
  const words: string[] = []
  let index = 0
  while (index < command.length) {
    const char = command[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const scan = quotedEnd(command, index)
      if (scan.unterminated) {
        throw new Error(`Unterminated ${char === '"' ? 'double' : 'single'} quote.`)
      }
      const body = command.slice(index + 1, scan.end - 1)
      words.push(char === '"' ? unquoteDouble(body) : body.replaceAll("\\'", "'"))
      index = scan.end
      continue
    }
    let end = index
    while (end < command.length && !/\s/.test(command[end])) {
      end += 1
    }
    words.push(command.slice(index, end))
    index = end
  }
  return words
}

/** A key as a console word, quoted only when redis-cli would need it. */
export function quoteRedisWord(word: string): string {
  if (word !== '' && /^[^\s"'\\]+$/.test(word)) {
    return word
  }
  const escaped = word.replace(/["\\\n\r\t]/g, (char) => {
    switch (char) {
      case '\n':
        return '\\n'
      case '\r':
        return '\\r'
      case '\t':
        return '\\t'
      default:
        return `\\${char}`
    }
  })
  return `"${escaped}"`
}
