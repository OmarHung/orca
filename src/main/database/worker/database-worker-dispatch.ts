import type { DatabaseDriver } from '../../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../../shared/database/database-query-types'
import { readOnlyRefusal, readOnlyViolation } from '../../../shared/database/sql-read-only-guard'
import type { DatabaseDriverSession, OpenDatabaseDriverSession } from './database-driver'
import { routeThroughTunnel } from './database-connection-route'
import { toDatabaseError } from './database-error-mapping'
import { DatabaseWorkerJobs } from './database-worker-jobs'
import type { NativeDumpTarget } from './dump/native/native-dump-plan'
import { findDumpTool } from './dump/native/native-dump-tools'
import type {
  DatabaseWorkerCommand,
  DatabaseWorkerMessage,
  DatabaseWorkerRequest
} from './database-worker-protocol'
import { openMysqlSession } from './mysql-session'
import { openPostgresSession } from './postgres-session'
import { openSqliteSession } from './sqlite-session'
import { openSqlServerSession } from './sqlserver-session'

export const openDriverSession: OpenDatabaseDriverSession = (connection, password, callbacks) => {
  switch (connection.driver) {
    case 'postgres':
      return openPostgresSession(connection, password, callbacks)
    case 'mysql':
      return openMysqlSession(connection, password, callbacks)
    case 'sqlserver':
      return openSqlServerSession(connection, password, callbacks)
    case 'sqlite':
      return openSqliteSession(connection)
  }
}

/** Runs worker commands against the one data source this worker owns. */
export function createDatabaseWorkerDispatcher(
  post: (message: DatabaseWorkerMessage) => void,
  openSession: OpenDatabaseDriverSession = openDriverSession
): (request: DatabaseWorkerRequest) => Promise<void> {
  let session: DatabaseDriverSession | null = null
  let driver: DatabaseDriver = 'postgres'
  // What pg_dump or mysqldump connects to: the same (tunneled) address and password.
  let nativeTarget: NativeDumpTarget | null = null
  const jobs = new DatabaseWorkerJobs(post)

  const requireSession = (): DatabaseDriverSession => {
    if (!session) {
      throw new Error('Not connected')
    }
    return session
  }

  const run = async (command: DatabaseWorkerCommand): Promise<unknown> => {
    switch (command.type) {
      case 'connect': {
        await session?.close()
        driver = command.connection.driver
        const connection = routeThroughTunnel(command.connection, command.tunnelPort)
        session = await openSession(connection, command.password, {
          onConnectionLost: (message) => post({ kind: 'connection-lost', message })
        })
        nativeTarget =
          connection.driver === 'postgres' || connection.driver === 'mysql'
            ? { connection, password: command.password, serverVersion: session.serverVersion }
            : null
        return { serverVersion: session.serverVersion }
      }
      case 'introspect':
        return requireSession().introspect(command.target)
      case 'ddl':
        return { ddl: await requireSession().ddl(command.target) }
      case 'execute': {
        // Why here: every statement from the page passes this one door before any session.
        const violation = readOnlyViolation(command.sql, driver)
        if (violation) {
          throw new Error(readOnlyRefusal(violation, driver))
        }
        return requireSession().execute(command.consoleId, command.sql, command.pageSize, {
          schema: command.schema,
          database: command.database
        })
      }
      case 'fetch':
        return requireSession().fetch(command.consoleId, command.resultId, command.pageSize)
      case 'cancel':
        return { cancelled: session ? await session.cancel(command.consoleId) : false }
      case 'closeConsole':
        await session?.closeConsole(command.consoleId)
        return null
      case 'dump':
        return jobs.dump(requireSession(), command, nativeTarget)
      case 'cancelJob':
        return { cancelled: jobs.cancel(command.jobId) }
      case 'dumpTool':
        return nativeTarget
          ? findDumpTool({
              driver: nativeTarget.connection.driver,
              serverVersion: nativeTarget.serverVersion
            })
          : null
      case 'close': {
        await jobs.stopAll()
        const closing = session
        session = null
        nativeTarget = null
        await closing?.close()
        return null
      }
    }
  }

  return async (request) => {
    let result: DatabaseResult<unknown>
    try {
      result = { ok: true, value: await run(request.command) }
    } catch (error) {
      result = { ok: false, error: toDatabaseError(error) }
    }
    post({ kind: 'response', id: request.id, result })
  }
}
