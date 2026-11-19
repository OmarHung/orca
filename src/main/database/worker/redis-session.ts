import type Redis from 'ioredis'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget,
  DatabaseRelationInfo
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseObjectProperties,
  DatabasePropertiesTarget
} from '../../../shared/database/database-properties-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { ConsolePool } from './console-pool'
import type { RoutedConnection } from './database-connection-route'
import type {
  DatabaseDriverCallbacks,
  DatabaseDriverSession,
  DatabaseExecuteOptions
} from './database-driver'
import type { DumpSource } from './dump/dump-source'
import {
  closeRedisClient,
  connectRedisClient,
  readRedisInfo,
  redisDatabaseIndex,
  redisServerVersion,
  type RedisConnectionDraft
} from './redis-client-factory'
import { parseRedisDatabaseName, RedisConsole, redisDatabaseName } from './redis-console'
import { redisProperties } from './redis-properties'
import { redisText } from './redis-replies'

/** How many keys the explorer lists under a database; the console reaches the rest. */
export const REDIS_EXPLORER_KEY_LIMIT = 2_000
const SCAN_BATCH = 1_000
const DEFAULT_DATABASE_COUNT = 16

export const NOT_SUPPORTED_FOR_REDIS = 'Redis has no SQL dump; read keys with a console instead.'

class RedisSession implements DatabaseDriverSession {
  private readonly consoles = new ConsolePool((_consoleId, onLost) =>
    connectRedisClient(this.connection, this.password, this.defaultDatabase, onLost).then(
      (client) => new RedisConsole(client, this.defaultDatabase)
    )
  )
  private readonly metaClients = new Map<number, Promise<Redis>>()

  constructor(
    private readonly connection: RoutedConnection<RedisConnectionDraft>,
    private readonly password: string | null,
    private readonly metaClient: Redis,
    readonly serverVersion: string,
    private readonly defaultDatabase: number,
    private readonly clusterMode: boolean,
    /** Set before closing on purpose, so the sessions' 'end' isn't reported as a lost connection. */
    private readonly lifecycle: { closing: boolean }
  ) {}

  /** A metadata session already on `index`, so no SELECT races another introspection. */
  metaFor(index: number): Promise<Redis> {
    if (index === this.defaultDatabase) {
      return Promise.resolve(this.metaClient)
    }
    const existing = this.metaClients.get(index)
    if (existing) {
      return existing
    }
    const forget = (): void => {
      if (this.metaClients.get(index) === created) {
        this.metaClients.delete(index)
      }
    }
    const created = connectRedisClient(this.connection, this.password, index, forget)
    this.metaClients.set(index, created)
    created.catch(forget)
    return created
  }

  async introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    switch (target.level) {
      case 'databases':
        return { level: 'databases', databases: await this.databases() }
      case 'schemas':
        return { level: 'schemas', schemas: await this.databases() }
      case 'relations':
        return { level: 'relations', relations: await this.keys(target.schema) }
      case 'columns':
        return { level: 'columns', columns: [] }
      case 'routines':
        return { level: 'routines', routines: [] }
      case 'keys':
        return { level: 'keys', keys: [] }
      case 'indexes':
        return { level: 'indexes', indexes: [] }
    }
  }

  private async databaseCount(): Promise<number> {
    if (this.clusterMode) {
      return 1
    }
    try {
      const reply = await this.metaClient.call('CONFIG', 'GET', 'databases')
      const count = Array.isArray(reply) ? Number(reply[1]) : Number.NaN
      if (Number.isInteger(count) && count > 0) {
        return count
      }
    } catch {
      // CONFIG is often refused (ACL) or renamed away on hosted Redis; INFO still lists databases.
    }
    const keyspace = await readRedisInfo(this.metaClient, 'keyspace')
    const highest = Math.max(
      -1,
      ...[...keyspace.keys()].flatMap((name) =>
        /^db\d+$/.test(name) ? [Number(name.slice(2))] : []
      )
    )
    return Math.max(DEFAULT_DATABASE_COUNT, highest + 1, this.defaultDatabase + 1)
  }

  private async databases(): Promise<{ name: string; isCurrent: boolean }[]> {
    const count = await this.databaseCount()
    return Array.from({ length: count }, (_, index) => ({
      name: redisDatabaseName(index),
      isCurrent: index === this.defaultDatabase
    }))
  }

  private async keys(schema: string): Promise<DatabaseRelationInfo[]> {
    const client = await this.metaFor(parseRedisDatabaseName(schema))
    const names = new Set<string>()
    let cursor = '0'
    do {
      const reply = await client.callBuffer('SCAN', cursor, 'COUNT', SCAN_BATCH)
      const [next, items] = Array.isArray(reply) ? reply : ['0', []]
      cursor = redisText(next) ?? '0'
      for (const item of Array.isArray(items) ? items : []) {
        const name = redisText(item)
        if (name !== null && names.size < REDIS_EXPLORER_KEY_LIMIT) {
          names.add(name)
        }
      }
    } while (cursor !== '0' && names.size < REDIS_EXPLORER_KEY_LIMIT)
    const sorted = [...names].sort()
    const pipeline = client.pipeline()
    sorted.forEach((name) => pipeline.call('TYPE', name))
    const types = (await pipeline.exec()) ?? []
    return sorted.map((name, index) => ({
      name,
      kind: 'key',
      comment: typeof types[index]?.[1] === 'string' ? String(types[index][1]) : null
    }))
  }

  async ddl(): Promise<string> {
    throw new Error('Redis keys have no DDL.')
  }

  properties(target: DatabasePropertiesTarget): Promise<DatabaseObjectProperties> {
    return redisProperties(this, target)
  }

  get metadata(): Redis {
    return this.metaClient
  }

  async execute(
    consoleId: string,
    command: string,
    pageSize: number,
    { schema }: DatabaseExecuteOptions
  ): Promise<DatabaseExecuteResult> {
    const target = await this.consoles.acquire(consoleId)
    await target.schema.prepare(schema)
    const result = await target.execute(command, pageSize)
    const switched = await target.schema.afterRun(command, result)
    return switched === undefined ? result : { ...result, schema: switched }
  }

  async fetch(consoleId: string, resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const pending = this.consoles.current(consoleId)
    if (!pending) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    return (await pending).fetch(resultId, pageSize)
  }

  async cancel(consoleId: string): Promise<boolean> {
    const pending = this.consoles.current(consoleId)
    if (!pending) {
      return false
    }
    ;(await pending).cancel()
    return true
  }

  closeConsole(consoleId: string): Promise<void> {
    return this.consoles.close(consoleId)
  }

  async openDumpSource(): Promise<DumpSource> {
    throw new Error(NOT_SUPPORTED_FOR_REDIS)
  }

  async close(): Promise<void> {
    this.lifecycle.closing = true
    await this.consoles.closeAll()
    const metas = [...this.metaClients.values()]
    this.metaClients.clear()
    await Promise.all(metas.map((pending) => pending.then(closeRedisClient).catch(() => undefined)))
    closeRedisClient(this.metaClient)
  }
}

export async function openRedisSession(
  connection: RoutedConnection<RedisConnectionDraft>,
  password: string | null,
  callbacks: DatabaseDriverCallbacks
): Promise<DatabaseDriverSession> {
  const defaultDatabase = redisDatabaseIndex(connection)
  const lifecycle = { closing: false }
  const metaClient = await connectRedisClient(connection, password, defaultDatabase, (error) => {
    if (!lifecycle.closing) {
      lifecycle.closing = true
      callbacks.onConnectionLost(error.message)
    }
  })
  const info = await readRedisInfo(metaClient, 'server')
  return new RedisSession(
    connection,
    password,
    metaClient,
    redisServerVersion(info),
    defaultDatabase,
    info.get('redis_mode') === 'cluster',
    lifecycle
  )
}
