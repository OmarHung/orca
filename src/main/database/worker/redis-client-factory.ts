import { isIP } from 'node:net'
import type { ConnectionOptions } from 'node:tls'
import Redis from 'ioredis'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type { RoutedConnection } from './database-connection-route'
import { DatabasePasswordRequiredError } from './database-error-mapping'

export type RedisConnectionDraft = Extract<DatabaseConnectionDraft, { driver: 'redis' }>

const CONNECT_TIMEOUT_MS = 15_000
// WRONGPASS (Redis 6+), NOAUTH (no password sent), "invalid password" (Redis 5 and older).
const AUTH_REJECTED = /^(?:WRONGPASS|NOAUTH)\b|invalid password|invalid username-password/i

/** The connection's own database index; blank is 0. */
export function redisDatabaseIndex(connection: RedisConnectionDraft): number {
  return connection.database === '' ? 0 : Number(connection.database)
}

function tlsOptions(
  connection: RoutedConnection<RedisConnectionDraft>
): ConnectionOptions | undefined {
  if (connection.sslMode === 'disable') {
    return undefined
  }
  // Why the real name: through a tunnel the socket dials 127.0.0.1, but TLS must name the server.
  const name = connection.tlsServerName ?? connection.host
  return {
    // Why trust under `require`: most self-hosted Redis servers present a self-signed certificate.
    rejectUnauthorized: connection.sslMode === 'verify-full',
    ...(isIP(name) === 0 ? { servername: name } : {})
  }
}

export function asRedisAuthError(error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error)
  return AUTH_REJECTED.test(message) ? new DatabasePasswordRequiredError(message) : error
}

/** Opens one Redis session on database `db`; it never reconnects, so a drop reaches `onLost`. */
export async function connectRedisClient(
  connection: RoutedConnection<RedisConnectionDraft>,
  password: string | null,
  db: number,
  onLost: (error: Error) => void
): Promise<Redis> {
  const client = new Redis({
    host: connection.host,
    port: connection.port,
    db,
    username: connection.user || undefined,
    password: password ?? undefined,
    tls: tlsOptions(connection),
    // Why RESP2: every server version answers it, and replies keep one shape.
    protocol: 2,
    stringNumbers: true,
    connectTimeout: CONNECT_TIMEOUT_MS,
    lazyConnect: true,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    disableClientInfo: true,
    autoResubscribe: false
  })
  let lost = false
  // Why keep it: a refused AUTH or a refused socket arrives here, while connect() itself only
  // rejects with "Connection is closed."
  let lastError: Error | null = null
  client.on('error', (error: Error) => {
    lastError = error
  })
  client.on('end', () => {
    if (!lost) {
      lost = true
      onLost(new Error('The Redis connection was closed.'))
    }
  })
  try {
    await client.connect()
    // Why PING: a server that wants a password accepts the socket and refuses the first command.
    await client.call('PING')
  } catch (error) {
    lost = true
    client.disconnect()
    throw asRedisAuthError(lastError ?? error)
  }
  return client
}

/** Closes a session without waiting on the server; QUIT would queue behind a running command. */
export function closeRedisClient(client: Redis): void {
  client.disconnect()
}

/** INFO's `field:value` lines, by section-less field name. */
export function parseRedisInfo(text: string): Map<string, string> {
  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon > 0 && !line.startsWith('#')) {
      fields.set(line.slice(0, colon), line.slice(colon + 1).trim())
    }
  }
  return fields
}

/** INFO, or empty when the login may not run it (ACL); callers then go without. */
export async function readRedisInfo(client: Redis, section?: string): Promise<Map<string, string>> {
  try {
    const text = await client.call('INFO', ...(section ? [section] : []))
    return parseRedisInfo(typeof text === 'string' ? text : String(text ?? ''))
  } catch {
    return new Map()
  }
}

export function redisServerVersion(info: Map<string, string>): string {
  const valkey = info.get('valkey_version')
  if (valkey) {
    return `Valkey ${valkey}`
  }
  return info.get('redis_version') ?? ''
}
