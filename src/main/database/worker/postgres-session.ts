import type pg from 'pg'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import { ConsolePool } from './console-pool'
import type {
  DatabaseDriverCallbacks,
  DatabaseDriverSession,
  DatabaseExecuteOptions
} from './database-driver'
import { PostgresDumpSource } from './dump/postgres-dump-source'
import type { DumpSource } from './dump/dump-source'
import { connectPostgresClient, type PostgresConnectionDraft } from './postgres-client-factory'
import { PostgresConsole } from './postgres-console'
import { postgresDdl } from './postgres-ddl'
import { introspectPostgres } from './postgres-introspection'
import { PostgresTypeNames } from './postgres-type-names'

class PostgresSession implements DatabaseDriverSession {
  private readonly consoles = new ConsolePool((consoleId, onLost) =>
    this.openConsole(consoleId, onLost)
  )
  // Other databases' catalogs are read on sessions of their own, opened on first use.
  private readonly metaClients = new Map<string, Promise<pg.Client>>()
  private readonly typeNames = new Map<string, PostgresTypeNames>()
  private readonly consoleDatabases = new Map<string, string>()

  constructor(
    private readonly connection: PostgresConnectionDraft,
    private readonly password: string | null,
    private readonly metaClient: pg.Client,
    readonly serverVersion: string,
    private readonly serverVersionNum: number,
    private readonly defaultDatabase: string
  ) {}

  async introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    const database = target.level === 'databases' ? undefined : target.database
    return introspectPostgres(await this.metaFor(database), target, this.serverVersionNum)
  }

  async ddl(target: DatabaseDdlTarget): Promise<string> {
    return postgresDdl(await this.metaFor(target.database), target, this.serverVersionNum)
  }

  private metaFor(database: string | undefined): Promise<pg.Client> {
    if (!database || database === this.defaultDatabase) {
      return Promise.resolve(this.metaClient)
    }
    const existing = this.metaClients.get(database)
    if (existing) {
      return existing
    }
    const forget = (): void => {
      if (this.metaClients.get(database) === created) {
        this.metaClients.delete(database)
      }
    }
    const created = connectPostgresClient({ ...this.connection, database }, this.password, forget)
    this.metaClients.set(database, created)
    created.catch(forget)
    return created
  }

  async execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    { schema, database }: DatabaseExecuteOptions
  ): Promise<DatabaseExecuteResult> {
    await this.moveConsole(consoleId, database ?? this.defaultDatabase)
    const target = await this.consoles.acquire(consoleId)
    await target.schema.prepare(schema)
    const result = { results: [await target.execute(sql, pageSize)] }
    const switched = await target.schema.afterRun(sql, result)
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
    const target = await pending
    // Why the meta session: the console's own session is busy running the statement.
    const result = await this.metaClient.query<{ cancelled: boolean }>(
      'select pg_catalog.pg_cancel_backend($1) as cancelled',
      [target.backendPid]
    )
    return result.rows[0]?.cancelled === true
  }

  /** A console picking another database gets a session there. */
  private async moveConsole(consoleId: string, database: string): Promise<void> {
    this.consoleDatabases.set(consoleId, database)
    const current = await this.consoles.current(consoleId)?.catch(() => null)
    if (!current || current.database === database) {
      return
    }
    await this.consoles.close(consoleId)
    this.consoleDatabases.set(consoleId, database)
  }

  closeConsole(consoleId: string): Promise<void> {
    this.consoleDatabases.delete(consoleId)
    return this.consoles.close(consoleId)
  }

  async openDumpSource(database: string | undefined): Promise<DumpSource> {
    // Why no loss callback: a dropped dump session fails its own read, not the connection.
    const client = await connectPostgresClient(
      { ...this.connection, database: database ?? this.defaultDatabase },
      this.password,
      () => undefined
    )
    return new PostgresDumpSource(client, this.serverVersionNum)
  }

  async close(): Promise<void> {
    await this.consoles.closeAll()
    const metas = [...this.metaClients.values()]
    this.metaClients.clear()
    await Promise.all(
      metas.map((pending) => pending.then((client) => client.end()).catch(() => undefined))
    )
    await this.metaClient.end().catch(() => undefined)
  }

  private async openConsole(consoleId: string, onLost: () => void): Promise<PostgresConsole> {
    const database = this.consoleDatabases.get(consoleId) ?? this.defaultDatabase
    const client = await connectPostgresClient(
      { ...this.connection, database },
      this.password,
      onLost
    )
    const pid = await client.query<{ pid: number }>('select pg_catalog.pg_backend_pid() as pid')
    return new PostgresConsole(client, pid.rows[0]!.pid, this.typeNamesIn(database), database)
  }

  private typeNamesIn(database: string): PostgresTypeNames {
    const existing = this.typeNames.get(database)
    if (existing) {
      return existing
    }
    const created = new PostgresTypeNames(() => this.metaFor(database))
    this.typeNames.set(database, created)
    return created
  }
}

export async function openPostgresSession(
  connection: PostgresConnectionDraft,
  password: string | null,
  callbacks: DatabaseDriverCallbacks
): Promise<DatabaseDriverSession> {
  let closedByServer = false
  const metaClient = await connectPostgresClient(connection, password, (error) => {
    if (!closedByServer) {
      closedByServer = true
      callbacks.onConnectionLost(error.message)
    }
  })
  try {
    const version = await metaClient.query<{
      server_version: string
      version_num: string
      database: string
    }>(
      "select current_setting('server_version') as server_version, current_setting('server_version_num') as version_num, current_database() as database"
    )
    const row = version.rows[0]!
    return new PostgresSession(
      connection,
      password,
      metaClient,
      row.server_version,
      Number(row.version_num),
      row.database
    )
  } catch (error) {
    await metaClient.end().catch(() => undefined)
    throw error
  }
}
