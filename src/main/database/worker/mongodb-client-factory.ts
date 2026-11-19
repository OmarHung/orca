import { isIP } from 'node:net'
import { MongoClient, type MongoClientOptions } from 'mongodb'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { RoutedConnection } from './database-connection-route'
import { DatabasePasswordRequiredError } from './database-error-mapping'

export type MongoConnectionDraft = Extract<DatabaseConnectionDraft, { driver: 'mongodb' }>

const CONNECT_TIMEOUT_MS = 15_000
// AuthenticationFailed; Unauthorized (13) is a missing privilege, which a password can't fix.
const AUTHENTICATION_FAILED = 18
/** Where unqualified statements run when the connection names no database, as in mongosh. */
export const MONGO_DEFAULT_DATABASE = 'test'

function hostPart(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host
}

function tlsOptions(connection: RoutedConnection<MongoConnectionDraft>): MongoClientOptions {
  if (connection.sslMode === 'disable') {
    return { tls: false }
  }
  const name = connection.tlsServerName ?? connection.host
  // Why trust under `require`: most self-hosted servers present a self-signed certificate.
  const trusting = connection.sslMode === 'require'
  return {
    tls: true,
    tlsAllowInvalidCertificates: trusting,
    tlsAllowInvalidHostnames: trusting,
    // Why the real name: through a tunnel the socket dials 127.0.0.1, but TLS must name the server.
    ...(isIP(name) === 0 ? { servername: name } : {})
  }
}

export function isMongoAuthFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  return (
    Reflect.get(error, 'code') === AUTHENTICATION_FAILED ||
    Reflect.get(error, 'codeName') === 'AuthenticationFailed'
  )
}

/**
 * One client talking to just this server (no replica-set discovery, which would dial members
 * by names a tunnel can't reach). Pool size 1 for a console, so closing it stops its command.
 */
export async function connectMongoClient(
  connection: RoutedConnection<MongoConnectionDraft>,
  password: string | null,
  maxPoolSize: number
): Promise<MongoClient> {
  const credentials = connection.user
    ? {
        auth: { username: connection.user, password: password ?? '' },
        ...(connection.authDatabase ? { authSource: connection.authDatabase } : {})
      }
    : {}
  const client = new MongoClient(`mongodb://${hostPart(connection.host)}:${connection.port}/`, {
    ...credentials,
    ...tlsOptions(connection),
    directConnection: true,
    appName: 'Orca',
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    maxPoolSize,
    // Why: 64-bit integers stay exact instead of becoming lossy JavaScript numbers.
    promoteLongs: false,
    retryWrites: false
  })
  try {
    await client.connect()
  } catch (error) {
    await client.close().catch(() => undefined)
    if (isMongoAuthFailure(error)) {
      throw new DatabasePasswordRequiredError(
        error instanceof Error ? error.message : String(error)
      )
    }
    throw error
  }
  return client
}

export async function mongoServerVersion(client: MongoClient): Promise<string> {
  const info = await client.db('admin').command({ buildInfo: 1 })
  return typeof info.version === 'string' ? info.version : ''
}
