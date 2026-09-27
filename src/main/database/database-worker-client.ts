import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { DatabaseResult } from '../../shared/database/database-query-types'
import { currentWorkerEntryLayout, resolveWorkerThreadEntryPath } from '../worker-thread-entry-path'
import type {
  DatabaseWorkerCommandOf,
  DatabaseWorkerCommandType,
  DatabaseWorkerMessage,
  DatabaseWorkerRequest,
  DatabaseWorkerValues
} from './worker/database-worker-protocol'

const WORKER_ENTRY_FILENAME = 'database-worker-entry.js'
// Why a cap: a runaway result must kill this data source's worker, not the main process.
const WORKER_HEAP_LIMIT_MB = 1024

export type DatabaseWorkerPort = {
  postMessage: (request: DatabaseWorkerRequest) => void
  onMessage: (listener: (message: DatabaseWorkerMessage) => void) => void
  /** May fire more than once (error, then exit). */
  onStop: (listener: (reason: string) => void) => void
  terminate: () => Promise<unknown>
}

function resolveDatabaseWorkerEntryPath(): string {
  const layout = currentWorkerEntryLayout(__dirname)
  const primary = resolveWorkerThreadEntryPath(layout, WORKER_ENTRY_FILENAME)
  if (layout.isPackaged || existsSync(primary)) {
    return primary
  }
  // Rollup can factor this module into out/main/chunks; worker entries stay in out/main.
  return join(__dirname, '..', WORKER_ENTRY_FILENAME)
}

export function spawnDatabaseWorker(): DatabaseWorkerPort {
  const entryPath = resolveDatabaseWorkerEntryPath()
  if (!existsSync(entryPath)) {
    throw new Error(`Database worker entry not found: ${entryPath}`)
  }
  const worker = new Worker(entryPath, {
    resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_LIMIT_MB }
  })
  return {
    postMessage: (request) => worker.postMessage(request),
    onMessage: (listener) => worker.on('message', listener),
    onStop: (listener) => {
      worker.on('error', (error: unknown) =>
        listener(error instanceof Error ? error.message : String(error))
      )
      worker.on('exit', (code) => listener(`exited with code ${code}`))
    },
    terminate: () => worker.terminate()
  }
}

type Resolver = (result: DatabaseResult<unknown>) => void

/** Request/response over one data source's worker; every request settles, even if it dies. */
export class DatabaseWorkerClient {
  private readonly pending = new Map<number, Resolver>()
  private nextId = 1
  private stoppedReason: string | null = null

  constructor(
    private readonly port: DatabaseWorkerPort,
    private readonly onConnectionLost: (message: string) => void
  ) {
    port.onMessage((message) => {
      if (message.kind === 'connection-lost') {
        onConnectionLost(message.message)
        return
      }
      const resolve = this.pending.get(message.id)
      this.pending.delete(message.id)
      resolve?.(message.result)
    })
    port.onStop((reason) => this.stop(`Database worker stopped: ${reason}`, true))
  }

  request<T extends DatabaseWorkerCommandType>(
    command: DatabaseWorkerCommandOf<T>
  ): Promise<DatabaseResult<DatabaseWorkerValues[T]>> {
    if (this.stoppedReason) {
      return Promise.resolve({
        ok: false,
        error: { message: this.stoppedReason, code: 'unavailable' }
      })
    }
    const id = this.nextId++
    return new Promise((resolve) => {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the worker answers each command type with its DatabaseWorkerValues entry (database-worker-dispatch.ts).
      this.pending.set(id, resolve as Resolver)
      this.port.postMessage({ id, command })
    })
  }

  async terminate(): Promise<void> {
    this.stop('Database session closed', false)
    await this.port.terminate().catch(() => undefined)
  }

  private stop(reason: string, unexpected: boolean): void {
    if (this.stoppedReason) {
      return
    }
    this.stoppedReason = reason
    for (const resolve of this.pending.values()) {
      resolve({ ok: false, error: { message: reason, code: 'unavailable' } })
    }
    this.pending.clear()
    if (unexpected) {
      this.onConnectionLost(reason)
    }
  }
}
