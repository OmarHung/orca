import type { DatabaseCell, DatabaseColumn } from '../../../shared/database/database-query-types'

/** One grid (or a bare acknowledgement) a Redis reply turns into. */
export type RedisReplyTable =
  | { kind: 'rows'; columns: DatabaseColumn[]; rows: DatabaseCell[][] }
  | { kind: 'command'; command: string }

const utf8 = new TextDecoder('utf-8', { fatal: true })

type RedisJson = string | null | RedisJson[]

function redisJson(value: unknown): RedisJson {
  return Array.isArray(value) ? value.map(redisJson) : redisText(value)
}

/** A reply value as grid text: UTF-8 when it decodes, else `0x…` like the SQL drivers' bytes. */
export function redisText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  if (Buffer.isBuffer(value)) {
    try {
      return utf8.decode(value)
    } catch {
      return `0x${value.toString('hex')}`
    }
  }
  if (Array.isArray(value)) {
    return JSON.stringify(redisJson(value))
  }
  return String(value)
}

const column = (name: string, typeName = 'string'): DatabaseColumn => ({ name, typeName })

function pairs(items: unknown[], left: DatabaseColumn, right: DatabaseColumn): RedisReplyTable {
  const rows: DatabaseCell[][] = []
  for (let index = 0; index + 1 < items.length; index += 2) {
    rows.push([redisText(items[index]), redisText(items[index + 1])])
  }
  return { kind: 'rows', columns: [left, right], rows }
}

function values(items: unknown[], name = 'value'): RedisReplyTable {
  return { kind: 'rows', columns: [column(name)], rows: items.map((item) => [redisText(item)]) }
}

/** Stream entries, `[[id, [field, value, …]], …]`, with each entry's fields as one JSON object. */
export function streamEntryRow(entry: unknown): DatabaseCell[] {
  if (!Array.isArray(entry)) {
    return [redisText(entry), null]
  }
  const [id, fields] = entry
  const object: Record<string, string | null> = {}
  if (Array.isArray(fields)) {
    for (let index = 0; index + 1 < fields.length; index += 2) {
      object[redisText(fields[index]) ?? ''] = redisText(fields[index + 1])
    }
  }
  return [redisText(id), JSON.stringify(object)]
}

const STREAM_COLUMNS = [column('id'), column('fields', 'json')]

function infoRows(text: string): RedisReplyTable {
  const rows: DatabaseCell[][] = []
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) {
      section = line.slice(1).trim()
      continue
    }
    const colon = line.indexOf(':')
    if (colon > 0) {
      rows.push([section, line.slice(0, colon), line.slice(colon + 1)])
    }
  }
  return { kind: 'rows', columns: [column('section'), column('field'), column('value')], rows }
}

const LINE_LISTS = new Set(['CLIENT LIST', 'CLUSTER NODES'])

const WITH_SCORES = new Set([
  'ZRANGE',
  'ZRANGEBYSCORE',
  'ZRANGEBYLEX',
  'ZREVRANGE',
  'ZREVRANGEBYSCORE',
  'ZREVRANGEBYLEX',
  'ZRANDMEMBER',
  'ZUNION',
  'ZINTER',
  'ZDIFF'
])
const SCAN_ITEMS: Record<string, { name: string; pairs?: string }> = {
  SCAN: { name: 'key' },
  SSCAN: { name: 'member' },
  HSCAN: { name: 'field', pairs: 'value' },
  ZSCAN: { name: 'member', pairs: 'score' }
}

function hasWord(words: readonly string[], word: string): boolean {
  return words.some((candidate, index) => index > 0 && candidate.toUpperCase() === word)
}

function scanTables(command: string, reply: unknown[]): RedisReplyTable[] {
  const layout = SCAN_ITEMS[command]
  const items = Array.isArray(reply[1]) ? reply[1] : []
  const main = layout.pairs
    ? pairs(
        items,
        column(layout.name),
        column(layout.pairs, command === 'ZSCAN' ? 'double' : 'string')
      )
    : values(items, layout.name)
  return [main, { kind: 'rows', columns: [column('next cursor')], rows: [[redisText(reply[0])]] }]
}

function arrayTables(
  words: readonly string[],
  command: string,
  reply: unknown[]
): RedisReplyTable[] {
  if (command in SCAN_ITEMS) {
    return scanTables(command, reply)
  }
  if (command === 'HGETALL' || (command === 'HRANDFIELD' && hasWord(words, 'WITHVALUES'))) {
    return [pairs(reply, column('field'), column('value'))]
  }
  if (command === 'CONFIG') {
    return [pairs(reply, column('parameter'), column('value'))]
  }
  if (WITH_SCORES.has(command) && hasWord(words, 'WITHSCORES')) {
    return [pairs(reply, column('member'), column('score', 'double'))]
  }
  if (command === 'XRANGE' || command === 'XREVRANGE') {
    return [{ kind: 'rows', columns: STREAM_COLUMNS, rows: reply.map(streamEntryRow) }]
  }
  if (command === 'XREAD') {
    const rows = reply.flatMap((stream) => {
      const [name, entries] = Array.isArray(stream) ? stream : [stream, []]
      return (Array.isArray(entries) ? entries : []).map((entry) => [
        redisText(name),
        ...streamEntryRow(entry)
      ])
    })
    return [{ kind: 'rows', columns: [column('stream'), ...STREAM_COLUMNS], rows }]
  }
  return [values(reply)]
}

/** How the grid shows one command's reply. */
export function redisReplyTables(words: readonly string[], reply: unknown): RedisReplyTable[] {
  const command = (words[0] ?? '').toUpperCase()
  if (Array.isArray(reply)) {
    return arrayTables(words, command, reply)
  }
  const text = redisText(reply)
  if (text === 'OK') {
    return [{ kind: 'command', command }]
  }
  if (command === 'INFO' && text !== null) {
    return [infoRows(text)]
  }
  // Why lines: these list one client or node per line.
  if (text !== null && LINE_LISTS.has(`${command} ${(words[1] ?? '').toUpperCase()}`)) {
    return [values(text.split('\n').filter((line) => line.trim() !== ''))]
  }
  // Why not Buffers: with stringNumbers, integer replies are the only plain strings.
  const isInteger =
    typeof reply === 'number' || (typeof reply === 'string' && /^-?\d+$/.test(reply))
  const typeName = isInteger ? 'integer' : 'string'
  return [{ kind: 'rows', columns: [column('value', typeName)], rows: [[text]] }]
}
