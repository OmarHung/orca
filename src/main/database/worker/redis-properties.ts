import type Redis from 'ioredis'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget,
  DatabasePropertySection
} from '../../../shared/database/database-properties-types'
import { formatUptime, optionalRead, property } from './database-property-values'
import { readRedisInfo } from './redis-client-factory'
import { parseRedisDatabaseName } from './redis-console'

export type RedisPropertiesSource = {
  readonly serverVersion: string
  readonly metadata: Redis
  metaFor: (index: number) => Promise<Redis>
}

/** How many elements each type holds, by the command that counts them. */
const LENGTH_COMMANDS: Record<string, string> = {
  string: 'STRLEN',
  hash: 'HLEN',
  list: 'LLEN',
  set: 'SCARD',
  zset: 'ZCARD',
  stream: 'XLEN'
}

/** INFO keyspace's `keys=12,expires=3,avg_ttl=0` for one database. */
function keyspaceEntry(value: string | undefined): Map<string, string> {
  return new Map(
    (value ?? '').split(',').flatMap((pair): [string, string][] => {
      const [name, count] = pair.split('=')
      return name && count !== undefined ? [[name, count]] : []
    })
  )
}

async function serverSection(source: RedisPropertiesSource): Promise<DatabasePropertySection> {
  const info = await readRedisInfo(source.metadata)
  const keyspace = [...info.entries()].filter(([name]) => /^db\d+$/.test(name))
  const keys = keyspace.reduce(
    (sum, [, value]) => sum + Number(keyspaceEntry(value).get('keys') ?? 0),
    0
  )
  const uptime = Number(info.get('uptime_in_seconds'))
  return {
    kind: 'server',
    name: null,
    properties: [
      ...property('version', source.serverVersion),
      ...property('mode', info.get('redis_mode')),
      ...property('uptime', Number.isFinite(uptime) ? formatUptime(uptime) : null),
      ...property('usedMemory', info.get('used_memory'), 'bytes'),
      ...property('keyCount', keyspace.length > 0 ? keys : null, 'count')
    ]
  }
}

async function databaseSection(
  source: RedisPropertiesSource,
  name: string
): Promise<DatabasePropertySection> {
  const client = await source.metaFor(parseRedisDatabaseName(name))
  const keyspace = keyspaceEntry((await readRedisInfo(client, 'keyspace')).get(name))
  return {
    kind: 'database',
    name,
    properties: [
      ...property('keyCount', String(await client.call('DBSIZE')), 'count'),
      ...property('expiringKeys', keyspace.get('expires') ?? '0', 'count')
    ]
  }
}

function describeTtl(milliseconds: number): string | null {
  if (milliseconds === -1) {
    return 'none'
  }
  return milliseconds >= 0 ? `${(milliseconds / 1000).toFixed(3)} s` : null
}

async function keySection(
  source: RedisPropertiesSource,
  schema: string,
  key: string,
  notes: string[]
): Promise<DatabasePropertySection> {
  const client = await source.metaFor(parseRedisDatabaseName(schema))
  const type = String(await client.call('TYPE', key))
  if (type === 'none') {
    throw new Error(`The key ${JSON.stringify(key)} does not exist.`)
  }
  const lengthCommand = LENGTH_COMMANDS[type]
  const length = lengthCommand ? await client.call(lengthCommand, key) : null
  const ttl = Number(await client.call('PTTL', key))
  const encoding = await optionalRead(notes, 'encoding', () =>
    client.call('OBJECT', 'ENCODING', key)
  )
  const size = await optionalRead(notes, 'memory usage', () => client.call('MEMORY', 'USAGE', key))
  return {
    kind: 'key',
    name: key,
    properties: [
      ...property('type', type),
      ...property('length', length, 'count'),
      ...property('ttl', describeTtl(ttl)),
      ...property('encoding', encoding),
      ...property('size', size, 'bytes')
    ]
  }
}

export async function redisProperties(
  source: RedisPropertiesSource,
  target: DatabasePropertiesTarget
): Promise<DatabaseObjectProperties> {
  const notes: string[] = []
  switch (target.kind) {
    case 'server':
      return { sections: [await serverSection(source)], columns: null, notes }
    case 'database':
      return { sections: [await databaseSection(source, target.database)], columns: null, notes }
    case 'schema':
      return { sections: [await databaseSection(source, target.schema)], columns: null, notes }
    case 'relation':
      return {
        sections: [await keySection(source, target.schema, target.relation, notes)],
        columns: null,
        notes
      }
  }
}
