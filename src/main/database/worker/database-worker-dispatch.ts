import type { DatabaseDriver } from '../../../shared/database/database-connection-types'
import type { DatabaseResult } from '../../../shared/database/database-query-types'
import { tableChangeStatements } from '../../../shared/database/table-change-sql'
import type { DatabaseDriverSession, OpenDatabaseDriverSession } from './database-driver'
import { routeThroughTunnel } from './database-connection-route'
import { toDatabaseError } from './database-error-mapping'
import type {
  DatabaseWorkerCommand,
  DatabaseWorkerMessage,
  DatabaseWorkerRequest
} from './database-worker-protocol'
import { openMysqlSession } from './mysql-session'
import { openPostgresSession } from './postgres-session'
import { openSqliteSession } from './sqlite-session'
import { openSqlServerSession } from './sqlserver-session'
import { applyTableChanges } from './table-change-transaction'
import { DatabaseWorkerJobs } from './database-worker-jobs'

const openDriverSession: OpenDatabaseDriverSession = (connection, password, callbacks) => {
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
        return { serverVersion: session.serverVersion }
      }
      case 'introspect':
        return requireSession().introspect(command.target)
      case 'ddl':
        return { ddl: await requireSession().ddl(command.target) }
      case 'execute':
        return requireSession().execute(command.consoleId, command.sql, command.pageSize, {
          mode: command.transactionMode ?? 'auto',
          schema: command.schema,
          database: command.database
        })
      case 'fetch':
        return requireSession().fetch(command.consoleId, command.resultId, command.pageSize)
      case 'applyChanges': {
        const statements = tableChangeStatements(driver, command.changeSet)
        const transaction = await requireSession().beginChanges(command.consoleId)
        return applyTableChanges(transaction, statements)
      }
      case 'cancel':
        return { cancelled: session ? await session.cancel(command.consoleId) : false }
      case 'closeConsole':
        await session?.closeConsole(command.consoleId)
        return null
      case 'runScript':
        return jobs.runScript(requireSession(), driver, command)
      case 'cancelJob':
        return { cancelled: await jobs.cancel(session, command.jobId) }
      case 'close': {
        const closing = session
        session = null
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
