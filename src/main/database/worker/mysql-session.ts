import type mysql from 'mysql2'
import type {
  DatabaseIntrospectResult,
  DatabaseIntrospectTarget
} from '../../../shared/database/database-introspection-types'
import type {
  DatabaseExecuteResult,
  DatabaseRowsPage
} from '../../../shared/database/database-query-types'
import type { DatabaseDriverCallbacks, DatabaseDriverSession } from './database-driver'
import type { DatabaseChangeTransaction } from './table-change-transaction'
import {
  connectMysqlClient,
  endMysqlClient,
  queryMysqlRows,
  type MysqlConnectionDraft
} from './mysql-client-factory'
import { MysqlConsole } from './mysql-console'
import { introspectMysql } from './mysql-introspection'

class MysqlSession implements DatabaseDriverSession {
  private readonly consoles = new Map<string, Promise<MysqlConsole>>()

  constructor(
    private readonly connection: MysqlConnectionDraft,
    private readonly password: string | null,
    private readonly metaClient: mysql.Connection,
    readonly serverVersion: string
  ) {}

  introspect(target: DatabaseIntrospectTarget): Promise<DatabaseIntrospectResult> {
    return introspectMysql(this.metaClient, target)
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

  async beginChanges(consoleId: string): Promise<DatabaseChangeTransaction> {
    return (await this.console(consoleId)).beginChanges()
  }

  async cancel(consoleId: string): Promise<boolean> {
    const pending = this.consoles.get(consoleId)
    if (!pending) {
      return false
    }
    await this.killQuery((await pending).client.threadId)
    return true
  }

  async closeConsole(consoleId: string): Promise<void> {
    const pending = this.consoles.get(consoleId)
    this.consoles.delete(consoleId)
    await pending?.then((target) => target.close()).catch(() => undefined)
  }

  async close(): Promise<void> {
    await Promise.all([...this.consoles.keys()].map((consoleId) => this.closeConsole(consoleId)))
    await endMysqlClient(this.metaClient)
  }

  // Why the metadata session: the console's own session is busy running the statement.
  private async killQuery(threadId: number): Promise<void> {
    await queryMysqlRows(this.metaClient, `KILL QUERY ${Number(threadId)}`)
  }

  private console(consoleId: string): Promise<MysqlConsole> {
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
    const created = connectMysqlClient(this.connection, this.password, forget).then(
      (client) => new MysqlConsole(client, (threadId) => this.killQuery(threadId))
    )
    this.consoles.set(consoleId, created)
    created.catch(forget)
    return created
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
