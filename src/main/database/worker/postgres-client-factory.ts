import pg from 'pg'
import type { ConnectionOptions } from 'node:tls'
import type {
  DatabaseConnectionDraft,
  DatabaseSslMode
} from '../../../shared/database/database-connection-types'

export type PostgresConnectionDraft = Extract<DatabaseConnectionDraft, { driver: 'postgres' }>

const CONNECT_TIMEOUT_MS = 15_000
const SSL_UNSUPPORTED_MESSAGE = /does not support SSL/i

/** SSL attempts in order; `prefer` falls back to plaintext only when the server refuses SSL. */
function sslAttempts(mode: DatabaseSslMode): (ConnectionOptions | false)[] {
  switch (mode) {
    case 'disable':
      return [false]
    case 'prefer':
      return [{ rejectUnauthorized: false }, false]
    case 'require':
      // Why: libpq's `require` encrypts without verifying the certificate.
      return [{ rejectUnauthorized: false }]
    case 'verify-full':
      return [{ rejectUnauthorized: true }]
  }
}

function buildClientConfig(
  connection: PostgresConnectionDraft,
  password: string | null,
  ssl: ConnectionOptions | false
): pg.ClientConfig {
  return {
    host: connection.host,
    port: connection.port,
    database: connection.database || undefined,
    user: connection.user || undefined,
    // Why undefined, not '': lets pg fall back to ~/.pgpass like psql does.
    password: password ?? undefined,
    ssl,
    application_name: 'Orca',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    keepAlive: true
  }
}

/**
 * Opens one server session. `onError` must be attached before connect: pg emits
 * connection-level failures as `error` events, which would otherwise crash the worker.
 */
export async function connectPostgresClient(
  connection: PostgresConnectionDraft,
  password: string | null,
  onError: (error: Error) => void
): Promise<pg.Client> {
  const attempts = sslAttempts(connection.sslMode)
  let lastError: unknown = null
  for (const [index, ssl] of attempts.entries()) {
    const client = new pg.Client(buildClientConfig(connection, password, ssl))
    client.on('error', onError)
    try {
      await client.connect()
      if (connection.readOnly) {
        await client.query('SET default_transaction_read_only = on')
      }
      return client
    } catch (error) {
      lastError = error
      await client.end().catch(() => undefined)
      const canFallBack = index < attempts.length - 1
      const message = error instanceof Error ? error.message : ''
      if (!canFallBack || !SSL_UNSUPPORTED_MESSAGE.test(message)) {
        throw error
      }
    }
  }
  throw lastError
}
