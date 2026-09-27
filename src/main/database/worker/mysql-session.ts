import type mysql from 'mysql2'
import type { DatabaseDdlTarget } from '../../../shared/database/database-ddl-types'
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
  connectMysqlClient,
  endMysqlClient,
  queryMysqlRows,
  type MysqlConnectionDraft
} from './mysql-client-factory'
import { MysqlConsole } from './mysql-console'
import { mysqlDdl } from './mysql-ddl'
import { introspectMysql } from './mysql-introspection'

class MysqlSession implements DatabaseDriverSession {
  private readonly consoles = new ConsolePool((onLost) =>
    connectMysqlClient(this.connection, this.password, onLost).then(
      (client) => new MysqlConsole(client, (threadId) => this.killQuery(threadId))
    )
  )

  constructor(
    private readonly connection: MysqlConnectionDraft,
    private readonly password: string | null,
    private readonly metaClient: mysql.Connection,
    readonly serverVersion: string
  ) {}

  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    return introspectMysql(this.metaClient, target)
  }

  ddl(target: DatabaseDdlTarget): Promise<string> {
    return mysqlDdl(this.metaClient, target)
  }

  async execute(
    consoleId: string,
    sql: string,
    pageSize: number,
    mode: DatabaseTransactionMode,
    schema?: string
  ): Promise<DatabaseExecuteResult> {
    const target = await this.consoles.acquire(consoleId)
    await target.schema.prepare(schema)
    const result = await target.transactions.run(mode, sql, () => target.execute(sql, pageSize))
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
    await this.killQuery((await pending).client.threadId)
    return true
  }

  closeConsole(consoleId: string): Promise<void> {
    return this.consoles.close(consoleId)
  }

  async close(): Promise<void> {
    await this.consoles.closeAll()
    await endMysqlClient(this.metaClient)
  }

  // Why the metadata session: the console's own session is busy running the statement.
  private async killQuery(threadId: number): Promise<void> {
    await queryMysqlRows(this.metaClient, `KILL QUERY ${Number(threadId)}`)
  }
}

export async function openMysqlSession(
  connection: MysqlConnectionDraft,
  password: string | null,
  callbacks: DatabaseDriverCallbacks
): Promise<DatabaseDriverSession> {
  let lost = false
  const metaClient = await connectMysqlClient(connection, password, (error) => {
    if (!lost) {
      lost = true
      callbacks.onConnectionLost(error.message)
    }
  })
  try {
    const [row] = await queryMysqlRows(metaClient, 'select version() as version')
    return new MysqlSession(connection, password, metaClient, String(row?.version ?? ''))
  } catch (error) {
    await endMysqlClient(metaClient)
    throw error
  }
}
