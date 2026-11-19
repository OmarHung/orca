import type Redis from 'ioredis'
import type { DatabaseCell, DatabaseColumn } from '../../../shared/database/database-query-types'
import { arrayRowReader, type RowReader } from './open-result-pager'
import { redisText, streamEntryRow } from './redis-replies'

export type RedisKeyView = { columns: DatabaseColumn[]; reader: RowReader }

const column = (name: string, typeName = 'string'): DatabaseColumn => ({ name, typeName })

function asArray(reply: unknown): unknown[] {
  return Array.isArray(reply) ? reply : []
}

/**
 * HSCAN, SSCAN or ZSCAN from cursor 0 to the end, a page at a time. SCAN may hand back an
 * element twice while the server rehashes; that is Redis' own guarantee, kept as is.
 */
function scanReader(
  client: Redis,
  command: 'HSCAN' | 'SSCAN',
  key: string,
  width: 1 | 2
): RowReader {
  let cursor = '0'
  let started = false
  const pending: DatabaseCell[][] = []
  const finished = (): boolean => started && cursor === '0'
  return {
    read: async (count) => {
      while (pending.length < count && !finished()) {
        const reply = asArray(await client.callBuffer(command, key, cursor, 'COUNT', count))
        started = true
        cursor = redisText(reply[0]) ?? '0'
        const items = asArray(reply[1])
        for (let index = 0; index + width - 1 < items.length; index += width) {
          pending.push(items.slice(index, index + width).map(redisText))
        }
      }
      const rows = pending.splice(0, count)
      return { rows, done: finished() && pending.length === 0 }
    },
    close: async () => undefined
  }
}

/** LRANGE or ZRANGE by position, so lists keep their order and sorted sets their ranking. */
function rangeReader(
  readRange: (start: number, stop: number) => Promise<DatabaseCell[][]>,
  length: number
): RowReader {
  let next = 0
  return {
    read: async (count) => {
      const rows = next < length ? await readRange(next, next + count - 1) : []
      next += count
      return { rows, done: next >= length || rows.length < count }
    },
    close: async () => undefined
  }
}

function streamReader(client: Redis, key: string): RowReader {
  let after: string | null = null
  let done = false
  return {
    read: async (count) => {
      if (done) {
        return { rows: [], done }
      }
      const start = after === null ? '-' : `(${after}`
      const entries = asArray(await client.callBuffer('XRANGE', key, start, '+', 'COUNT', count))
      const last = entries.at(-1)
      after = last === undefined ? after : redisText(asArray(last)[0])
      done = entries.length < count
      return { rows: entries.map(streamEntryRow), done }
    },
    close: async () => undefined
  }
}

const STREAM_COLUMNS = [column('id'), column('fields', 'json')]

/** The whole value of `key` as a grid, read a page at a time where the type allows it. */
export async function openRedisKeyView(client: Redis, key: string): Promise<RedisKeyView> {
  const type = String(await client.call('TYPE', key))
  switch (type) {
    case 'none':
      throw new Error(`The key ${JSON.stringify(key)} does not exist.`)
    case 'string':
      return {
        columns: [column('value')],
        reader: arrayRowReader([[redisText(await client.callBuffer('GET', key))]])
      }
    case 'hash':
      return {
        columns: [column('field'), column('value')],
        reader: scanReader(client, 'HSCAN', key, 2)
      }
    case 'set':
      return { columns: [column('member')], reader: scanReader(client, 'SSCAN', key, 1) }
    case 'list': {
      const length = Number(await client.call('LLEN', key))
      const readRange = async (start: number, stop: number): Promise<DatabaseCell[][]> =>
        asArray(await client.callBuffer('LRANGE', key, start, stop)).map((item, offset) => [
          String(start + offset),
          redisText(item)
        ])
      return {
        columns: [column('index', 'integer'), column('value')],
        reader: rangeReader(readRange, length)
      }
    }
    case 'zset': {
      const length = Number(await client.call('ZCARD', key))
      const readRange = async (start: number, stop: number): Promise<DatabaseCell[][]> => {
        const items = asArray(await client.callBuffer('ZRANGE', key, start, stop, 'WITHSCORES'))
        const rows: DatabaseCell[][] = []
        for (let index = 0; index + 1 < items.length; index += 2) {
          rows.push([redisText(items[index]), redisText(items[index + 1])])
        }
        return rows
      }
      return {
        columns: [column('member'), column('score', 'double')],
        reader: rangeReader(readRange, length)
      }
    }
    case 'stream':
      return { columns: STREAM_COLUMNS, reader: streamReader(client, key) }
    case 'ReJSON-RL':
      return {
        columns: [column('value', 'json')],
        reader: arrayRowReader([[redisText(await client.callBuffer('JSON.GET', key))]])
      }
    default:
      throw new Error(
        `Orca can't show a value of type ${type}. Read it with that module's commands in a console.`
      )
  }
}
