import { existsSync, statSync } from 'node:fs'
import type { SftpLocalRoot } from '../../../shared/sftp-types'
import { forkProcess } from '../../../shared/child-process/fork-process'
import type { SpawnedProcess } from '../../../shared/child-process/process-spec'
import { RUNTIME_ENV_ALLOWLIST, pickAllowedEnv } from '../../ai-vault/session-scanner-service-env'
import {
  currentWorkerEntryLayout,
  resolveForkedProcessEntryPath
} from '../../worker-thread-entry-path'
import type { LocalWriterCommand, LocalWriterResponse } from './sftp-local-writer-protocol'

const ENTRY_FILENAME = 'sftp-local-writer-entry.js'
const STDERR_TAIL_CHARS = 2_000

/** Starts the writer process with `cwd` as its working directory. */
export type SpawnSftpLocalWriter = (cwd: string) => SpawnedProcess

/** Local writes for one download, all inside the folder the user confirmed. */
export type SftpLocalWriter = {
  mkdir(segments: string[]): Promise<void>
  /** A hidden partial file beside the target; `commit` renames it into place. */
  open(segments: string[]): Promise<number>
  write(handle: number, position: number, data: Buffer): Promise<void>
  commit(handle: number): Promise<void>
  /** Removes the partial file. */
  abort(handle: number): Promise<void>
  close(): Promise<void>
}

type Pending = { resolve: (response: LocalWriterResponse) => void; reject: (error: Error) => void }

export function spawnSftpLocalWriterProcess(cwd: string): SpawnedProcess {
  const entryPath = resolveForkedProcessEntryPath(
    currentWorkerEntryLayout(__dirname),
    ENTRY_FILENAME
  )
  if (!existsSync(entryPath)) {
    throw new Error(`SFTP download helper not found: ${entryPath}`)
  }
  return forkProcess({
    modulePath: entryPath,
    cwd,
    // Why an allowlist: shell-exported secrets and NODE_OPTIONS have no business in the child.
    env: {
      ...pickAllowedEnv(RUNTIME_ENV_ALLOWLIST, process.env, process.platform),
      ELECTRON_RUN_AS_NODE: '1'
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'advanced'
  })
}

/**
 * Starts a writer bound to `root`: it refuses to write anything unless the folder at `root.path`
 * is still the one identified when the download was planned.
 */
export async function openSftpLocalWriter(
  root: SftpLocalRoot,
  spawn: SpawnSftpLocalWriter = spawnSftpLocalWriterProcess
): Promise<SftpLocalWriter> {
  // Why: only for a clear message; the writer's identity check is what guards the folder.
  if (!statSync(root.path, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`"${root.path}" is no longer a folder, so nothing was downloaded.`)
  }
  const child = spawn(root.path)
  const pending = new Map<number, Pending>()
  let nextId = 1
  let stopped: Error | null = null
  let stderrTail = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_CHARS)
  })
  let running = true
  const exited = new Promise<void>((resolve) => {
    const settle = (): void => {
      running = false
      resolve()
    }
    child.once('exit', settle)
    // Why: a process that never started emits 'error' and no 'exit'.
    child.once('error', () => {
      if (child.pid === undefined) {
        settle()
      }
    })
  })
  const stop = (error: Error): void => {
    stopped ??= error
    for (const entry of pending.values()) {
      entry.reject(error)
    }
    pending.clear()
  }
  child.on('message', (response: LocalWriterResponse) => {
    const entry = pending.get(response.id)
    pending.delete(response.id)
    entry?.resolve(response)
  })
  // Why `on`: a later send or disconnect on a dead channel emits 'error' again, and an unheard one would throw.
  child.on('error', (error) => stop(new Error(`The SFTP download helper failed: ${error.message}`)))
  child.once('exit', (code, signal) => {
    const tail = stderrTail.trim().split('\n').at(-1)
    stop(
      new Error(
        `The SFTP download helper exited with ${signal ?? `code ${code}`}${tail ? `: ${tail}` : ''}`
      )
    )
  })

  const request = async (command: LocalWriterCommand): Promise<number | undefined> => {
    if (stopped) {
      throw stopped
    }
    const id = nextId
    nextId += 1
    const response = await new Promise<LocalWriterResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.send({ ...command, id })
    })
    if (!response.ok) {
      throw new Error(response.error)
    }
    return response.handle
  }

  const close = async (): Promise<void> => {
    if (!running) {
      return
    }
    // Why: disconnecting tells the writer to remove unfinished partial files and exit.
    if (child.connected) {
      child.disconnect()
    } else {
      child.kill()
    }
    await exited
  }

  try {
    await request({ type: 'init', root: { dev: root.dev, ino: root.ino } })
  } catch (error) {
    await close()
    throw error
  }
  return {
    mkdir: async (segments) => {
      await request({ type: 'mkdir', segments })
    },
    open: async (segments) => {
      const handle = await request({ type: 'open', segments })
      if (handle === undefined) {
        throw new Error('The SFTP download helper did not open the file.')
      }
      return handle
    },
    write: async (handle, position, data) => {
      await request({ type: 'write', handle, position, data })
    },
    commit: async (handle) => {
      await request({ type: 'commit', handle })
    },
    abort: async (handle) => {
      await request({ type: 'abort', handle })
    },
    close
  }
}
