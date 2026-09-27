import { DatabaseSync } from 'node:sqlite'
import mysql from 'mysql2/promise'
import pg from 'pg'
import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import { closeSqlServer, connectSqlServer, querySqlServerRows } from './sqlserver-client-factory'

// Test-only: every session Orca opens is read-only, so fixtures are set up and torn down on a
// writable connection of their own, straight through each driver.

type AdminTarget = { connection: DatabaseConnectionDraft; password: string | null }

/**
 * Runs `statements` in order on a new writable connection; `database` overrides the
 * connection's own (PostgreSQL, MySQL, SQL Server). Stops at the first failure unless
 * `ignoreErrors` (for teardown).
 */
export async function runAdminSql(
  { connection, password }: AdminTarget,
  statements: readonly string[],
  options: { database?: string; ignoreErrors?: boolean } = {}
): Promise<void> {
  const run = async (execute: (sql: string) => Promise<unknown>): Promise<void> => {
    for (const sql of statements) {
      try {
        await execute(sql)
      } catch (error) {
        if (!options.ignoreErrors) {
          throw error
        }
      }
    }
  }
  switch (connection.driver) {
    case 'sqlite': {
      const database = new DatabaseSync(connection.filePath)
      try {
        await run(async (sql) => database.exec(sql))
      } finally {
        database.close()
      }
      return
    }
    case 'postgres': {
      const client = new pg.Client({
        host: connection.host,
        port: connection.port,
        database: options.database ?? (connection.database || 'postgres'),
        user: connection.user || undefined,
        password: password ?? undefined
      })
      await client.connect()
      try {
        await run((sql) => client.query(sql))
      } finally {
        await client.end()
      }
      return
    }
    case 'mysql': {
      const client = await mysql.createConnection({
        host: connection.host,
        port: connection.port,
        user: connection.user || undefined,
        password: password ?? undefined,
        database: options.database ?? (connection.database || undefined)
      })
      try {
        await run((sql) => client.query(sql))
      } finally {
        await client.end()
      }
      return
    }
    case 'sqlserver': {
      const database = options.database ?? connection.database
      const client = await connectSqlServer({ ...connection, database }, password, () => undefined)
      try {
        await run((sql) => querySqlServerRows(client, sql))
      } finally {
        await closeSqlServer(client)
      }
    }
  }
}
