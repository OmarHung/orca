import { spawnProcess } from '../../shared/child-process/run-process'
import {
  forceTerminateProcessTree,
  signalProcessTree
} from '../../shared/child-process/process-tree-termination'
import type { DapTransport, DapTransportClose } from './dap-transport'

const GRACEFUL_STOP_MS = 3_000

export type StdioDapTransportSpec = {
  program: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  onStderr?: (text: string) => void
}

/** Runs a debug adapter as a child process speaking DAP over stdin/stdout. */
export function startStdioDapTransport(spec: StdioDapTransportSpec): DapTransport {
  const child = spawnProcess({
    program: spec.program,
    args: spec.args,
    cwd: spec.cwd,
    env: spec.env,
    // Why: own process group so stopping the adapter also stops the program it launched.
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeoutMs: null
  })
  const closeListeners = new Set<(reason: DapTransportClose) => void>()
  let closeReason: DapTransportClose | null = null
  let spawnError: Error | null = null

  const finish = (reason: DapTransportClose): void => {
    if (closeReason) {
      return
    }
    closeReason = reason
    for (const listener of closeListeners) {
      listener(reason)
    }
  }

  child.on('error', (error) => {
    spawnError = error
    // Why: a failed spawn never emits `exit`, so report the close here.
    if (child.pid === undefined) {
      finish({ code: null, signal: null, error })
    }
  })
  child.on('exit', (code, signal) => {
    // Why: an adapter that crashes leaves the program it launched paused in its process
    // group, waiting for a debugger that will never come. Nothing else owns that group.
    if (process.platform !== 'win32' && child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        // The group is already empty.
      }
    }
    finish({ code, signal, error: spawnError })
  })
  child.stdin.on('error', () => {})
  child.stderr.on('data', (chunk: Buffer) => spec.onStderr?.(chunk.toString('utf8')))

  return {
    write(data) {
      if (!closeReason && child.stdin.writable) {
        child.stdin.write(data)
      }
    },
    onData(listener) {
      child.stdout.on('data', listener)
    },
    onClose(listener) {
      if (closeReason) {
        listener(closeReason)
        return
      }
      closeListeners.add(listener)
    },
    close() {
      if (closeReason) {
        return
      }
      void signalProcessTree(child, 'SIGTERM')
      const forceTimer = setTimeout(() => {
        if (!closeReason) {
          void forceTerminateProcessTree(child)
        }
      }, GRACEFUL_STOP_MS)
      forceTimer.unref?.()
    }
  }
}
