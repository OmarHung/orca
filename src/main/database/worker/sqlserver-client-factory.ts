import { Connection, Request, TYPES } from 'tedious'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { RoutedConnection } from './database-connection-route'
import { SQLSERVER_LOGIN_FAILED } from './database-error-mapping'
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

type SqlServerLoginReason = { number: number; message: string }

/**
 * A login SQL Server refused (tedious' ELOGIN), with every reason it sent: for a database it
 * can't open, 4060's "Cannot open database" comes before the 18456 that tedious alone keeps.
 */
export class SqlServerLoginError extends Error {
  readonly code = 'ELOGIN'

  constructor(
    message: string,
    /** The server's reason: 18456 for the login itself, else the one before it, e.g. 4060. */
    readonly number: number | undefined
  ) {
    super(message)
  }
}

export function sqlServerLoginFailure(
  error: Error,
  reasons: readonly SqlServerLoginReason[]
): Error {
  if (Reflect.get(error, 'code') !== 'ELOGIN') {
    return error
  }
  const messages = [...new Set(reasons.map((reason) => reason.message))]
  const reason =
    reasons.find((candidate) => candidate.number !== SQLSERVER_LOGIN_FAILED) ?? reasons.at(-1)
  return new SqlServerLoginError(messages.join(' ') || error.message, reason?.number)
}

/** Opens one TDS session. `onError` must be attached before connect so drops never crash the worker. */
export function connectSqlServer(
  connection: RoutedConnection<SqlServerConnectionDraft>,
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
      ...(connection.tlsServerName ? { serverName: connection.tlsServerName } : {}),
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
  const reasons: SqlServerLoginReason[] = []
  const onLoginError = (token: SqlServerLoginReason): void => {
    reasons.push({ number: token.number, message: token.message })
  }
  client.on('errorMessage', onLoginError)
  return new Promise((resolve, reject) => {
    client.connect((error) => {
      client.removeListener('errorMessage', onLoginError)
      if (error) {
        client.close()
        reject(sqlServerLoginFailure(error, reasons))
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
