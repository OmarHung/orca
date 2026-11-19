import type { Db, MongoClient } from 'mongodb'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
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
import type { DatabaseDriverSession, DatabaseExecuteOptions } from './database-driver'
import type { DumpSource } from './dump/dump-source'
import {
  mongoCollections,
  mongoDatabases,
  mongoDdl,
  mongoIndexes,
  relationInfo,
  sampledFields
} from './mongodb-catalog'
import {
  connectMongoClient,
  MONGO_DEFAULT_DATABASE,
  mongoServerVersion,
  type MongoConnectionDraft
} from './mongodb-client-factory'
import { MongoConsole } from './mongodb-console'
import { mongoProperties } from './mongodb-properties'

// Why a few: the explorer expands several nodes at once on the metadata client.
const META_POOL_SIZE = 4

export const NOT_SUPPORTED_FOR_MONGODB =
  'MongoDB has no SQL dump; read documents with a console instead.'

class MongoSession implements DatabaseDriverSession {
  private readonly consoles = new ConsolePool((_consoleId, onLost) =>
    connectMongoClient(this.connection, this.password, 1).then(
      (client) => new MongoConsole(client, this.defaultDatabase, onLost)
    )
  )

  constructor(
    private readonly connection: RoutedConnection<MongoConnectionDraft>,
    private readonly password: string | null,
    readonly client: MongoClient,
    readonly serverVersion: string
  ) {}

  private get defaultDatabase(): string {
    return this.connection.database || MONGO_DEFAULT_DATABASE
  }

  databaseNamed(name: string | undefined): Db {
    return this.client.db(name ?? this.defaultDatabase)
  }

  async introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    switch (target.level) {
      case 'databases': {
        const databases = await mongoDatabases(
          this.client,
          this.defaultDatabase,
          this.connection.database
        )
        return { level: 'databases', databases }
      }
      case 'schemas': {
        const schemas = await mongoDatabases(
          this.client,
          this.defaultDatabase,
          this.connection.database
        )
        return { level: 'schemas', schemas }
      }
      case 'relations': {
        const collections = await mongoCollections(this.databaseNamed(target.schema))
        return { level: 'relations', relations: collections.map(relationInfo) }
      }
      case 'columns':
        return {
          level: 'columns',
          columns: await sampledFields(this.databaseNamed(target.schema), target.relation)
        }
      case 'indexes':
        return {
          level: 'indexes',
          indexes: await mongoIndexes(this.databaseNamed(target.schema), target.relation)
        }
      case 'keys':
        return { level: 'keys', keys: [] }
      case 'routines':
        return { level: 'routines', routines: [] }
    }
  }

  ddl(target: DatabaseDdlTarget): Promise<string> {
    return mongoDdl(this.databaseNamed(target.schema), target)
  }

  properties(target: DatabasePropertiesTarget): Promise<DatabaseObjectProperties> {
    return mongoProperties(this, target)
  }

  async execute(
    consoleId: string,
    statement: string,
    pageSize: number,
    { schema }: DatabaseExecuteOptions
  ): Promise<DatabaseExecuteResult> {
    const target = await this.consoles.acquire(consoleId)
    await target.schema.prepare(schema)
    const result = await target.execute(statement, pageSize)
    const switched = await target.schema.afterRun(statement, result)
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
    throw new Error(NOT_SUPPORTED_FOR_MONGODB)
  }

  async close(): Promise<void> {
    await this.consoles.closeAll()
    await this.client.close().catch(() => undefined)
  }
}

/**
 * The driver reconnects by itself while the server is unreachable, so a drop shows as the
 * next statement's error rather than a lost connection; SSH tunnels still report their own.
 */
export async function openMongoSession(
  connection: RoutedConnection<MongoConnectionDraft>,
  password: string | null
): Promise<DatabaseDriverSession> {
  const client = await connectMongoClient(connection, password, META_POOL_SIZE)
  try {
    return new MongoSession(connection, password, client, await mongoServerVersion(client))
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}
