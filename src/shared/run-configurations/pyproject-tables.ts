/** String keys per table header, e.g. `project.scripts` → { serve: 'app.cli:main' }. */
export type PyprojectTables = ReadonlyMap<string, ReadonlyMap<string, string>>

const TABLE_HEADER = /^\[\s*([^[\]]+?)\s*\]\s*(?:#.*)?$/
const STRING_ENTRY =
  /^(?:"([^"\\]+)"|'([^']+)'|([A-Za-z0-9_-]+))\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/

function tableName(header: string): string {
  return header
    .split('.')
    .map((part) => part.trim().replace(/^(["'])(.*)\1$/, '$2'))
    .join('.')
}

function countOf(line: string, needle: string): number {
  return line.split(needle).length - 1
}

/**
 * Reads the single-line string keys of each table, which is all run detection needs (names and
 * `[project.scripts]`). Array tables, inline tables and multi-line values are skipped.
 */
export function readPyprojectTables(text: string): PyprojectTables {
  const tables = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = new Map()
  tables.set('', current)
  let openMultiline: string | null = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (openMultiline) {
      if (countOf(line, openMultiline) % 2 === 1) {
        openMultiline = null
      }
      continue
    }
    const delimiter = ['"""', "'''"].find((candidate) => countOf(line, candidate) % 2 === 1)
    if (delimiter) {
      // Why: a multi-line string can hold lines that look like headers or keys.
      openMultiline = delimiter
      continue
    }
    if (line.startsWith('[[')) {
      current = null
      continue
    }
    const header = TABLE_HEADER.exec(line)
    if (header) {
      const name = tableName(header[1])
      current = tables.get(name) ?? new Map()
      tables.set(name, current)
      continue
    }
    const entry = current ? STRING_ENTRY.exec(line) : null
    if (current && entry) {
      current.set(entry[1] ?? entry[2] ?? entry[3], entry[4] ?? entry[5])
    }
  }
  return tables
}
