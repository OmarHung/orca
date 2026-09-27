import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage,
  DatabaseTransactionMode
} from '../../../shared/database/database-query-types'
import { ConsolePool } from './console-pool'
import type { DatabaseDriverCallbacks, DatabaseDriverSession } from './database-driver'
import type { DatabaseChangeTransaction } from './table-change-transaction'
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
  private readonly consoles = new ConsolePool((onLost) =>
    connectSqlServer(this.connection, this.password, onLost).then(
      (client) => new SqlServerConsole(client, this.connection.readOnly)
    )
  )

  constructor(
    private readonly connection: SqlServerConnectionDraft,
    private readonly password: string | null,
    private readonly meta: SqlServerRequestQueue,
    readonly serverVersion: string
  ) {}

  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    return this.meta.run((client) => introspectSqlServer(client, target))
  }

  async execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    mode: DatabaseTransactionMode
  ): Promise<DatabaseExecuteResult> {
    const target = await this.consoles.acquire(consoleId)
    return target.transactions.run(mode, sql, () => target.execute(sql, pageSize))
  }

  async fetch(consoleId: string, resultId: string, pageSize: number): Promise<DatabaseRowsPage> {
    const pending = this.consoles.current(consoleId)
    if (!pending) {
      throw new Error('This result is no longer open. Run the statement again to load more rows.')
    }
    return (await pending).fetch(resultId, pageSize)
  }

  // TDS cancels in-band (an attention packet), so no second session is needed.
  async beginChanges(consoleId: string): Promise<DatabaseChangeTransaction> {
    return (await this.consoles.acquire(consoleId)).beginChanges()
  }

  async cancel(consoleId: string): Promise<boolean> {
    const pending = this.consoles.current(consoleId)
    return pending ? (await pending).cancel() : false
  }

  closeConsole(consoleId: string): Promise<void> {
    return this.consoles.close(consoleId)
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
