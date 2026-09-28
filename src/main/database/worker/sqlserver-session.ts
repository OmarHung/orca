import type { Connection } from 'tedious'
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
import { quoteSqlName } from '../../../shared/database/sql-identifiers'
import type {
  DatabaseDriverCallbacks,
  DatabaseDriverSession,
  DatabaseExecuteOptions
} from './database-driver'
import {
  SqlServerRequestQueue,
  closeSqlServer,
  connectSqlServer,
  querySqlServerRows,
  type SqlServerConnectionDraft
} from './sqlserver-client-factory'
import type { DumpSource } from './dump/dump-source'
import { SqlServerDumpSource } from './dump/sqlserver-dump-source'
import { SqlServerConsole } from './sqlserver-console'
import { sqlServerDdl } from './sqlserver-ddl'
import { introspectSqlServer } from './sqlserver-introspection'
import { sqlServerProperties } from './sqlserver-properties'

class SqlServerSession implements DatabaseDriverSession {
  private readonly consoles = new ConsolePool((_consoleId, onLost) =>
    connectSqlServer(this.connection, this.password, onLost).then(
      (client) => new SqlServerConsole(client)
    )
  )

  constructor(
    private readonly connection: SqlServerConnectionDraft,
    private readonly password: string | null,
    private readonly meta: SqlServerRequestQueue,
    readonly serverVersion: string,
    private readonly defaultDatabase: string
  ) {
    this.metaDatabase = defaultDatabase
  }

  // Where the metadata session is; catalog reads of another database USE it first.
  private metaDatabase: string

  private onMeta<T>(
    database: string | undefined,
    task: (client: Connection) => Promise<T>
  ): Promise<T> {
    return this.meta.run(async (client) => {
      const wanted = database ?? this.defaultDatabase
      if (wanted !== this.metaDatabase) {
        await querySqlServerRows(client, `USE ${quoteSqlName(wanted, 'sqlserver')}`)
        this.metaDatabase = wanted
      }
      return task(client)
    })
  }

  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    const database = target.level === 'databases' ? undefined : target.database
    return this.onMeta(database, (client) => introspectSqlServer(client, target))
  }

  ddl(target: DatabaseDdlTarget): Promise<string> {
    return this.onMeta(target.database, (client) => sqlServerDdl(client, target))
  }

  properties(target: DatabasePropertiesTarget): Promise<DatabaseObjectProperties> {
    return sqlServerProperties((database, task) => this.onMeta(database, task), target)
  }

  async execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    { database }: DatabaseExecuteOptions
  ): Promise<DatabaseExecuteResult> {
    const target = await this.consoles.acquire(consoleId)
    await target.database.prepare(database)
    const result = await target.execute(sql, pageSize)
    const switched = await target.database.afterRun(sql, result)
    return switched === undefined ? result : { ...result, database: switched }
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
    return pending ? (await pending).cancel() : false
  }

  closeConsole(consoleId: string): Promise<void> {
    return this.consoles.close(consoleId)
  }

  async openDumpSource(database: string | undefined): Promise<DumpSource> {
    const client = await connectSqlServer(
      { ...this.connection, database: database ?? this.defaultDatabase },
      this.password,
      () => undefined
    )
    return new SqlServerDumpSource(client)
  }

  async close(): Promise<void> {
    await this.consoles.closeAll()
    await closeSqlServer(this.meta.client)
  }
}

export async function openSqlServerSession(
  connection: SqlServerConnectionDraft,
  password: string | null,
  callbacks: DatabaseDriverCallbacks
): Promise<DatabaseDriverSession> {
  let lost = false
  const client = await connectSqlServer(connection, password, (error) => {
    if (!lost) {
      lost = true
      callbacks.onConnectionLost(error.message)
    }
  })
  try {
    const [row] = await querySqlServerRows(
      client,
      "select cast(serverproperty('ProductVersion') as nvarchar(128)) as version, db_name() as db"
    )
    return new SqlServerSession(
      connection,
      password,
      new SqlServerRequestQueue(client),
      String(row?.version ?? ''),
      String(row?.db ?? '')
    )
  } catch (error) {
    await closeSqlServer(client)
    throw error
  }
}
