import { Connection, Request, TYPES } from 'tedious'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { SqlServerColumnMeta } from './sqlserver-values'

export type SqlServerConnectionDraft = Extract<DatabaseConnectionDraft, { driver: 'sqlserver' }>

const CONNECT_TIMEOUT_MS = 15_000

function encryption(mode: SqlServerConnectionDraft['sslMode']): {
  encrypt: boolean
  trustServerCertificate: boolean
} {
  switch (mode) {
    case 'disable':
      return { encrypt: false, trustServerCertificate: true }
    case 'require':
      // Why trust: most dev SQL Servers present a self-signed certificate.
      return { encrypt: true, trustServerCertificate: true }
    case 'verify-full':
      return { encrypt: true, trustServerCertificate: false }
  }
}

/** Opens one TDS session. `onError` must be attached before connect so drops never crash the worker. */
export function connectSqlServer(
  connection: SqlServerConnectionDraft,
  password: string | null,
  onError: (error: Error) => void
): Promise<Connection> {
  const client = new Connection({
    server: connection.host,
    authentication: {
      type: 'default',
      options: { userName: connection.user, password: password ?? '' }
    },
    options: {
      port: connection.port,
      database: connection.database || undefined,
      ...encryption(connection.sslMode),
      appName: 'Orca',
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Why 0: statements run until they finish or the user cancels.
      requestTimeout: 0,
      rowCollectionOnRequestCompletion: false,
      useColumnNames: false,
      useUTC: true
    }
  })
  client.on('error', onError)
  return new Promise((resolve, reject) => {
    client.connect((error) => {
      if (error) {
        client.close()
        reject(error)
      } else {
        resolve(client)
      }
    })
  })
}

export function closeSqlServer(client: Connection): Promise<void> {
  if (client.closed) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    client.once('end', () => resolve())
    client.close()
  })
}

type RowValue = { value: unknown; metadata: SqlServerColumnMeta }

/** Runs a parameterized metadata query (nvarchar parameters) and returns row objects. */
export function querySqlServerRows(
  client: Connection,
  sql: string,
  parameters: Record<string, string> = {}
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const rows: Record<string, unknown>[] = []
    const request = new Request(sql, (error) => (error ? reject(error) : resolve(rows)))
    for (const [name, value] of Object.entries(parameters)) {
      request.addParameter(name, TYPES.NVarChar, value)
    }
    request.on('row', (columns: RowValue[]) => {
      rows.push(
        Object.fromEntries(columns.map((column) => [column.metadata.colName, column.value]))
      )
    })
    client.execSql(request)
  })
}

/** tedious runs one request per connection at a time; this serializes metadata queries. */
export class SqlServerRequestQueue {
  private tail: Promise<unknown> = Promise.resolve()

  constructor(readonly client: Connection) {}

  run<T>(task: (client: Connection) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => task(this.client))
    this.tail = next.catch(() => undefined)
    return next
  }
}
