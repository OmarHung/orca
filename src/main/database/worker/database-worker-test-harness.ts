import type { DatabaseConnectionDraft } from '../../../shared/database/database-connection-types'
import type {
  DatabaseQueryResult,
  DatabaseResult,
  DatabaseRowsResult
} from '../../../shared/database/database-query-types'
import type { DatabaseJobProgress } from '../../../shared/database/database-dump-types'
import { createDatabaseWorkerDispatcher } from './database-worker-dispatch'
import type {
  DatabaseWorkerCommand,
  DatabaseWorkerCommandType,
  DatabaseWorkerMessage,
  DatabaseWorkerValues
} from './database-worker-protocol'

// Test-only: drives the worker dispatcher in-process, the way the worker thread would.

export type WorkerHarness = {
  send: <T extends DatabaseWorkerCommandType>(
    command: Extract<DatabaseWorkerCommand, { type: T }>
  ) => Promise<DatabaseResult<DatabaseWorkerValues[T]>>
  lost: string[]
  progress: DatabaseJobProgress[]
}

export function createWorkerHarness(): WorkerHarness {
  const lost: string[] = []
  const progress: DatabaseJobProgress[] = []
  const pending = new Map<number, (result: DatabaseResult<unknown>) => void>()
  let nextId = 1
  const dispatch = createDatabaseWorkerDispatcher((message: DatabaseWorkerMessage) => {
    if (message.kind === 'connection-lost') {
      lost.push(message.message)
      return
    }
    if (message.kind === 'job-progress') {
      progress.push(message.progress)
      return
    }
    pending.get(message.id)?.(message.result)
  })
  return {
    lost,
    progress,
    send: (command) => {
      const id = nextId++
      return new Promise((resolve) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher answers each command type with its DatabaseWorkerValues entry.
        pending.set(id, (result) => resolve(result as DatabaseResult<never>))
        void dispatch({ id, command })
      })
    }
  }
}

export async function expectOk<T>(promise: Promise<DatabaseResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) {
    throw new Error(`expected ok, got: ${result.error.message}`)
  }
  return result.value
}

export function onlyResult(value: { results: DatabaseQueryResult[] }): DatabaseQueryResult {
  if (value.results.length !== 1) {
    throw new Error(`expected one result, got ${value.results.length}`)
  }
  return value.results[0]!
}

export function onlyRows(value: { results: DatabaseQueryResult[] }): DatabaseRowsResult {
  const result = onlyResult(value)
  if (result.kind !== 'rows') {
    throw new Error(`expected rows, got a ${result.command} command`)
  }
  return result
}

/** Builds a server connection from `scheme://user:password@host:port/database`. */
export function serverConnectionFromUrl(
  driver: 'postgres' | 'mysql' | 'sqlserver',
  url: string
): { connection: DatabaseConnectionDraft; password: string | null } {
  const parsed = new URL(url)
  const sslMode = 'disable' as const
  const connection: DatabaseConnectionDraft = {
    driver,
    name: `${driver} integration`,
    host: parsed.hostname,
    port: Number(parsed.port),
    database: decodeURIComponent(parsed.pathname.slice(1)),
    user: decodeURIComponent(parsed.username),
    sslMode,
    passwordStorage: 'never'
  }
  return { connection, password: parsed.password ? decodeURIComponent(parsed.password) : null }
}
