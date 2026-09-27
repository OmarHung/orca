import { connect as connectSocket } from 'node:net'
import mysql from 'mysql2'
import type {
  DatabaseConnectionDraft,
  DatabaseSslMode
} from '../../../shared/database/database-connection-types'
import type { RoutedConnection } from './database-connection-route'

export type MysqlConnectionDraft = Extract<DatabaseConnectionDraft, { driver: 'mysql' }>

const CONNECT_TIMEOUT_MS = 15_000
const SSL_UNSUPPORTED_CODE = 'HANDSHAKE_NO_SSL_SUPPORT'

type SslAttempt = mysql.SslOptions | undefined

/** SSL attempts in order; `prefer` falls back to plaintext only when the server has no TLS. */
function sslAttempts(mode: DatabaseSslMode): SslAttempt[] {
  switch (mode) {
    case 'disable':
      return [undefined]
    case 'prefer':
      return [{ rejectUnauthorized: false }, undefined]
    case 'require':
      return [{ rejectUnauthorized: false }]
    case 'verify-full':
      // Why verifyIdentity: without it mysql2 checks the chain but not the host name.
      return [{ rejectUnauthorized: true, verifyIdentity: true }]
  }
}

function connect(client: mysql.Connection): Promise<void> {
  return new Promise((resolve, reject) =>
    client.connect((error) => (error ? reject(error) : resolve()))
  )
}

/** Runs a metadata query and returns plain row objects. */
export function queryMysqlRows(
  client: mysql.Connection,
  sql: string,
  values: unknown[] = []
): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    client.query(sql, values, (error, rows: unknown) => {
      if (error) {
        reject(error)
        return
      }
      resolve(
        Array.isArray(rows)
          ? rows.filter(
              (row): row is Record<string, unknown> => typeof row === 'object' && row !== null
            )
          : []
      )
    })
  })
}

export function endMysqlClient(client: mysql.Connection): Promise<void> {
  return new Promise((resolve) => client.end(() => resolve()))
}

/** Opens one server session; `onError` hears drops once it is open. An error listener stays attached throughout so a drop never crashes the worker. */
export async function connectMysqlClient(
  connection: RoutedConnection<MysqlConnectionDraft>,
  password: string | null,
  onError: (error: Error) => void
): Promise<mysql.Connection> {
  const attempts = sslAttempts(connection.sslMode)
  let lastError: unknown = null
  for (const [index, ssl] of attempts.entries()) {
    const { tlsServerName } = connection
    const client = mysql.createConnection({
      // Why the real name as host: mysql2 names and verifies the TLS server after `host`.
      host: tlsServerName ?? connection.host,
      port: connection.port,
      ...(tlsServerName ? { stream: () => connectSocket(connection.port, connection.host) } : {}),
      user: connection.user || undefined,
      password: password ?? undefined,
      database: connection.database || undefined,
      ssl,
      connectTimeout: CONNECT_TIMEOUT_MS,
      charset: 'utf8mb4',
      // Why strings: keep the server's text form so DECIMAL/BIGINT/dates stay exact.
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      jsonStrings: true,
      multipleStatements: false
    })
    // Why not onError yet: connect's callback reports a failed attempt, and one that `prefer`
    // abandons for plaintext must not reach the session as a lost connection.
    const duringConnect = (): void => {}
    client.on('error', duringConnect)
    try {
      await connect(client)
      // Why every session, the catalog's too: Orca's database tools are read-only.
      await queryMysqlRows(client, 'SET SESSION TRANSACTION READ ONLY')
      client.off('error', duringConnect)
      client.on('error', onError)
      return client
    } catch (error) {
      lastError = error
      client.destroy()
      const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
      if (index === attempts.length - 1 || code !== SSL_UNSUPPORTED_CODE) {
        throw error
      }
    }
  }
  throw lastError
}
