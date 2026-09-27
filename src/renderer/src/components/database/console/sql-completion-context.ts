import {
  SQL_DIALECT_RULES,
  commentEnd,
  isIdentifierChar,
  isWhitespace,
  quotedTokenEnd,
  type SqlDialect
} from '../../../../../shared/database/sql-dialect-lexing'

/** `word` is a bare identifier or keyword; `name` is a quoted identifier, unquoted. */
export type SqlToken = {
  kind: 'word' | 'name' | 'string' | 'dot' | 'comma' | 'other'
  value: string
  start: number
  end: number
}

export type TableReference = { schema: string | null; name: string; alias: string | null }

export type CompletionSite =
  | { kind: 'relation'; schema: string | null }
  | { kind: 'member'; qualifier: string }
  | { kind: 'any' }

const RELATION_KEYWORDS = new Set(['from', 'join', 'update', 'into', 'table'])
// Words that can't be an alias.
const CLAUSE_WORDS = new Set([
  'where',
  'on',
  'using',
  'join',
  'inner',
  'left',
  'right',
  'full',
  'cross',
  'outer',
  'natural',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'fetch',
  'union',
  'except',
  'intersect',
  'set',
  'values',
  'select',
  'window',
  'returning',
  'lateral',
  'as',
  'with',
  'for',
  'default'
])

// Words that close a FROM list; JOIN and ON keep it open (`from a join b on x, c`).
const FROM_CLAUSE_END = new Set([
  'where',
  'group',
  'order',
  'having',
  'limit',
  'offset',
  'fetch',
  'union',
  'except',
  'intersect',
  'window',
  'returning',
  'set',
  'values',
  'select',
  'for'
])

function quotedKind(char: string, dialect: SqlDialect): SqlToken['kind'] {
  if (char === "'" || char === '$' || (char === '"' && dialect === 'mysql')) {
    return 'string'
  }
  return char === '/' ? 'other' : 'name'
}

function unquote(text: string): string {
  const open = text[0]
  const close = open === '[' ? ']' : open
  const inner = text.slice(1, text.endsWith(close ?? '') ? -1 : undefined)
  return close ? inner.replaceAll(close + close, close) : inner
}

/** Tokens a completion needs, skipping comments; strings keep their text but never name tables. */
export function tokenizeSql(sql: string, dialect: SqlDialect): SqlToken[] {
  const rules = SQL_DIALECT_RULES[dialect]
  const tokens: SqlToken[] = []
  let index = 0
  while (index < sql.length) {
    const char = sql[index]!
    const comment = commentEnd(sql, index, rules)
    if (comment !== null) {
      index = comment
      continue
    }
    const quoted = quotedTokenEnd(sql, index, rules)
    if (quoted !== null) {
      const kind = quotedKind(char, dialect)
      const text = sql.slice(index, quoted)
      tokens.push({
        kind,
        value: kind === 'other' ? text : unquote(text),
        start: index,
        end: quoted
      })
      index = quoted
      continue
    }
    if (isWhitespace(char)) {
      index += 1
      continue
    }
    if (isIdentifierChar(char)) {
      let end = index + 1
      while (isIdentifierChar(sql[end])) {
        end += 1
      }
      tokens.push({ kind: 'word', value: sql.slice(index, end), start: index, end })
      index = end
      continue
    }
    const kind = char === '.' ? 'dot' : char === ',' ? 'comma' : 'other'
    tokens.push({ kind, value: char, start: index, end: index + 1 })
    index += 1
  }
  return tokens
}

const isName = (token: SqlToken | undefined): token is SqlToken =>
  token !== undefined &&
  (token.kind === 'name' || (token.kind === 'word' && !CLAUSE_WORDS.has(token.value.toLowerCase())))

/** Reads `[schema.]name [[as] alias]` at `index`; returns it and the index after it. */
function readReference(
  tokens: readonly SqlToken[],
  index: number
): [TableReference, number] | null {
  const first = tokens[index]
  if (!isName(first)) {
    return null
  }
  let next = index + 1
  let schema: string | null = null
  let name = first.value
  if (tokens[next]?.kind === 'dot' && isName(tokens[next + 1])) {
    schema = first.value
    name = tokens[next + 1]!.value
    next += 2
  }
  if (tokens[next]?.kind === 'word' && tokens[next]!.value.toLowerCase() === 'as') {
    next += 1
  }
  const alias =
    isName(tokens[next]) && tokens[next + 1]?.kind !== 'dot' ? tokens[next]!.value : null
  return [{ schema, name, alias }, alias === null ? next : next + 1]
}

type ReferenceScan = { references: TableReference[]; fromListOpen: boolean }

/** One pass that tracks, per paren depth, whether a comma adds another table to a FROM list. */
function scanReferences(tokens: readonly SqlToken[]): ReferenceScan {
  const references: TableReference[] = []
  const openFromDepths = new Set<number>()
  let depth = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const keyword = token.kind === 'word' ? token.value.toLowerCase() : ''
    if (token.kind === 'other' && token.value === '(') {
      depth += 1
      continue
    }
    if (token.kind === 'other' && token.value === ')') {
      openFromDepths.delete(depth)
      depth = Math.max(0, depth - 1)
      continue
    }
    if (FROM_CLAUSE_END.has(keyword)) {
      openFromDepths.delete(depth)
    }
    const listComma = token.kind === 'comma' && openFromDepths.has(depth)
    if (!RELATION_KEYWORDS.has(keyword) && !listComma) {
      continue
    }
    if (keyword === 'from') {
      openFromDepths.add(depth)
    }
    const read = readReference(tokens, index + 1)
    if (read) {
      references.push(read[0])
      index = read[1] - 1
    }
  }
  return { references, fromListOpen: openFromDepths.has(depth) }
}

/** Tables a statement reads or writes, with their schema and alias. */
export function tableReferences(tokens: readonly SqlToken[]): TableReference[] {
  return scanReferences(tokens).references
}

/** What to suggest at `offset` in one statement's text, and the word being typed there. */
export function completionSite(
  statement: string,
  offset: number,
  dialect: SqlDialect
): { site: CompletionSite; prefix: string; references: TableReference[] } {
  let prefixStart = offset
  while (prefixStart > 0 && isIdentifierChar(statement[prefixStart - 1])) {
    prefixStart -= 1
  }
  const prefix = statement.slice(prefixStart, offset)
  const before = tokenizeSql(statement.slice(0, prefixStart), dialect)
  const references = tableReferences(tokenizeSql(statement, dialect))
  const last = before.at(-1)
  const beforeQualifier = before.at(-3)
  if (last?.kind === 'dot' && isName(before.at(-2))) {
    const qualifier = before.at(-2)!.value
    const afterRelationKeyword =
      beforeQualifier?.kind === 'word' && RELATION_KEYWORDS.has(beforeQualifier.value.toLowerCase())
    return {
      site: afterRelationKeyword
        ? { kind: 'relation', schema: qualifier }
        : { kind: 'member', qualifier },
      prefix,
      references
    }
  }
  const keyword = last?.kind === 'word' ? last.value.toLowerCase() : ''
  const inFromList = last?.kind === 'comma' && scanReferences(before).fromListOpen
  const site: CompletionSite =
    RELATION_KEYWORDS.has(keyword) || inFromList
      ? { kind: 'relation', schema: null }
      : { kind: 'any' }
  return { site, prefix, references }
}
