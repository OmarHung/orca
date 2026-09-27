import { existsSync } from 'node:fs'
import { forkProcess } from '../../shared/child-process/fork-process'
import { RUNTIME_ENV_ALLOWLIST, pickAllowedEnv } from '../ai-vault/session-scanner-service-env'
import type { DatabaseWorkerPort } from './database-worker-client'
import { resolveDatabaseWorkerEntryPath } from './database-worker-entry-path'
import type { DatabaseWorkerMessage } from './worker/database-worker-protocol'

const STDERR_TAIL_CHARS = 2_000

/**
 * Runs the database worker as a child process instead of a thread. SQLite executes inside
 * native code, where a worker thread can't be terminated mid-statement; a process can be killed.
 */
export function spawnDatabaseProcess(): DatabaseWorkerPort {
  const entryPath = resolveDatabaseWorkerEntryPath({ unpacked: true })
  if (!existsSync(entryPath)) {
    throw new Error(`Database worker entry not found: ${entryPath}`)
  }
  const child = forkProcess({
    modulePath: entryPath,
    // Why an allowlist: shell-exported secrets and NODE_OPTIONS have no business in the child.
    env: {
      ...pickAllowedEnv(RUNTIME_ENV_ALLOWLIST, process.env, process.platform),
      ELECTRON_RUN_AS_NODE: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  })
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_CHARS)
  })
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  return {
    postMessage: (request) => {
      child.send(request)
    },
    onMessage: (listener) => {
      child.on('message', (message: DatabaseWorkerMessage) => listener(message))
    },
    onStop: (listener) => {
      child.on('error', (error) => listener(error.message))
      child.on('exit', (code, signal) => {
        const tail = stderrTail.trim().split('\n').at(-1)
        listener(`exited with ${signal ?? `code ${code}`}${tail ? `: ${tail}` : ''}`)
      })
    },
    terminate: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      await exited
    }
  }
}
