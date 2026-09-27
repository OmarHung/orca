import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import type { DatabaseDriverCallbacks, DatabaseDriverSession } from './database-driver'
import {
  SqlServerRequestQueue,
  closeSqlServer,
  connectSqlServer,
  querySqlServerRows,
  type SqlServerConnectionDraft
} from './sqlserver-client-factory'
import { SqlServerConsole } from './sqlserver-console'
import { introspectSqlServer } from './sqlserver-introspection'

class SqlServerSession implements DatabaseDriverSession {
  private readonly consoles = new Map<string, Promise<SqlServerConsole>>()

  constructor(
    private readonly connection: SqlServerConnectionDraft,
    private readonly password: string | null,
    private readonly meta: SqlServerRequestQueue,
    readonly serverVersion: string
  ) {}

  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    return this.meta.run((client) => introspectSqlServer(client, target))
  }

  async execute(consoleId: string, sql: string, pageSize: number): Promise<DatabaseExecuteResult> {
    return (await this.console(consoleId)).execute(sql, pageSize)
  }

  async fetch(consoleId: string, resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const pending = this.consoles.get(consoleId)
    if (!pending) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    return (await pending).fetch(resultId, pageSize)
  }

  // TDS cancels in-band (an attention packet), so no second session is needed.
  async cancel(consoleId: string): Promise<boolean> {
    const pending = this.consoles.get(consoleId)
    return pending ? (await pending).cancel() : false
  }

  async closeConsole(consoleId: string): Promise<void> {
    const pending = this.consoles.get(consoleId)
    this.consoles.delete(consoleId)
    await pending?.then((target) => target.close()).catch(() => undefined)
  }

  async close(): Promise<void> {
    await Promise.all([...this.consoles.keys()].map((consoleId) => this.closeConsole(consoleId)))
    await closeSqlServer(this.meta.client)
  }

  private console(consoleId: string): Promise<SqlServerConsole> {
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
    const created = connectSqlServer(this.connection, this.password, forget).then(
      (client) => new SqlServerConsole(client, this.connection.readOnly)
    )
    this.consoles.set(consoleId, created)
    created.catch(forget)
    return created
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
      "select cast(serverproperty('ProductVersion') as nvarchar(128)) as version"
    )
    return new SqlServerSession(
      connection,
      password,
      new SqlServerRequestQueue(client),
      String(row?.version ?? '')
    )
  } catch (error) {
    await closeSqlServer(client)
    throw error
  }
}
