import type pg from 'pg'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import type { DatabaseDriverCallbacks, DatabaseDriverSession } from './database-driver'
import { connectPostgresClient, type PostgresConnectionDraft } from './postgres-client-factory'
import { PostgresConsole } from './postgres-console'
import { introspectPostgres } from './postgres-introspection'
import { PostgresTypeNames } from './postgres-type-names'

class PostgresSession implements DatabaseDriverSession {
  private readonly consoles = new Map<string, Promise<PostgresConsole>>()
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

  async execute(consoleId: string, sql: string, pageSize: number): Promise<DatabaseExecuteResult> {
    return { results: [await (await this.console(consoleId)).execute(sql, pageSize)] }
  }

  async fetch(consoleId: string, resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const pending = this.consoles.get(consoleId)
    if (!pending) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    return (await pending).fetch(resultId, pageSize)
  }

  async cancel(consoleId: string): Promise<boolean> {
    const pending = this.consoles.get(consoleId)
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

  async closeConsole(consoleId: string): Promise<void> {
    const pending = this.consoles.get(consoleId)
    this.consoles.delete(consoleId)
    await pending?.then((target) => target.close()).catch(() => undefined)
  }

  async close(): Promise<void> {
    await Promise.all([...this.consoles.keys()].map((consoleId) => this.closeConsole(consoleId)))
    await this.metaClient.end().catch(() => undefined)
  }

  private console(consoleId: string): Promise<PostgresConsole> {
    const existing = this.consoles.get(consoleId)
    if (existing) {
      return existing
    }
    // A dropped or failed console session reconnects on its next statement.
    const forget = (): void => {
      if (this.consoles.get(consoleId) === created) {
        this.consoles.delete(consoleId)
      }
    }
    const created = this.openConsole(forget)
    this.consoles.set(consoleId, created)
    created.catch(forget)
    return created
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
