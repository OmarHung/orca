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
import type { DatabaseChangeTransaction } from './table-change-transaction'
import { connectPostgresClient, type PostgresConnectionDraft } from './postgres-client-factory'
import { PostgresConsole } from './postgres-console'
import { postgresDdl } from './postgres-ddl'
import { introspectPostgres } from './postgres-introspection'
import { PostgresTypeNames } from './postgres-type-names'

class PostgresSession implements DatabaseDriverSession {
  private readonly consoles = new ConsolePool((onLost) => this.openConsole(onLost))
  private readonly typeNames: PostgresTypeNames

  constructor(
    private readonly connection: PostgresConnectionDraft,
    private readonly password: string | null,
    private readonly metaClient: pg.Client,
    readonly serverVersion: string,
    private readonly serverVersionNum: number
  ) {
    this.typeNames = new PostgresTypeNames(metaClient)
  }

  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    return introspectPostgres(this.metaClient, target, this.serverVersionNum)
  }

  ddl(target: DatabaseDdlTarget): Promise<string> {
    return postgresDdl(this.metaClient, target, this.serverVersionNum)
  }

  async execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    { mode, schema }: DatabaseExecuteOptions
  ): Promise<DatabaseExecuteResult> {
    const target = await this.consoles.acquire(consoleId)
    await target.schema.prepare(schema)
    const result = await target.transactions.run(mode, sql, async () => ({
      results: [await target.execute(sql, pageSize)]
    }))
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

  async beginChanges(consoleId: string): Promise<DatabaseChangeTransaction> {
    return (await this.consoles.acquire(consoleId)).beginChanges()
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

  closeConsole(consoleId: string): Promise<void> {
    return this.consoles.close(consoleId)
  }

  async close(): Promise<void> {
    await this.consoles.closeAll()
    await this.metaClient.end().catch(() => undefined)
  }

  private async openConsole(onLost: () => void): Promise<PostgresConsole> {
    const client = await connectPostgresClient(this.connection, this.password, onLost)
    const pid = await client.query<{ pid: number }>('select pg_catalog.pg_backend_pid() as pid')
    return new PostgresConsole(client, pid.rows[0]!.pid, this.typeNames)
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
    const version = await metaClient.query<{ server_version: string; version_num: string }>(
      "select current_setting('server_version') as server_version, current_setting('server_version_num') as version_num"
    )
    const row = version.rows[0]!
    return new PostgresSession(
      connection,
      password,
      metaClient,
      row.server_version,
      Number(row.version_num)
    )
  } catch (error) {
    await metaClient.end().catch(() => undefined)
    throw error
  }
}
