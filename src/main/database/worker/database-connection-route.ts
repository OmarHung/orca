import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'

/**
 * A connection as the worker dials it. Through an SSH tunnel the socket goes to
 * 127.0.0.1:<local port>, while TLS still names (and verifies) the real server.
 */
export type RoutedConnection<T extends DatabaseConnectionDraft = DatabaseConnectionDraft> = T & {
  /** Set when dialing a tunnel: the server name TLS must present and verify. */
  tlsServerName?: string
}

export function routeThroughTunnel(
  connection: DatabaseConnectionDraft,
  tunnelPort: number | undefined
): RoutedConnection {
  if (tunnelPort === undefined || connection.driver === 'sqlite') {
    return connection
  }
  return { ...connection, host: '127.0.0.1', port: tunnelPort, tlsServerName: connection.host }
}
