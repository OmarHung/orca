import type { DebugProtocol } from '@vscode/debugprotocol'
import type {
  DebugBreakpointsByFile,
  DebugSessionEvent
} from '../../shared/debug/debug-session-types'
import { DapClient } from './dap-client'
import type { DapTransport } from './dap-transport'

const INITIALIZED_TIMEOUT_MS = 30_000
const DISCONNECT_TIMEOUT_MS = 3_000

export type DebugSessionHandle = {
  id: string
  /** Settles once the program is launched and configured; rejects if the launch fails. */
  ready: Promise<void>
  request: (command: string, args: unknown) => Promise<unknown>
  /** Asks the adapter to end the program, then closes the connection. */
  stop: () => Promise<void>
  /** Kills the adapter immediately; for app quit, where there is no time for a round-trip. */
  dispose: () => void
}

export type StartDebugSessionOptions = {
  id: string
  adapterId: string
  transport: DapTransport
  launchArguments: Record<string, unknown>
  breakpoints: DebugBreakpointsByFile
  emit: (event: DebugSessionEvent) => void
}

function isCapabilities(value: unknown): value is DebugProtocol.Capabilities {
  return typeof value === 'object' && value !== null
}

function waitForEvent(client: DapClient, eventName: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Debug adapter did not send "${eventName}" within ${timeoutMs}ms`))
    }, timeoutMs)
    const unsubscribe = client.onEvent((event) => {
      if (event.event === eventName) {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      }
    })
  })
}

async function configure(
  client: DapClient,
  capabilities: DebugProtocol.Capabilities,
  breakpoints: DebugBreakpointsByFile
): Promise<void> {
  for (const [path, fileBreakpoints] of Object.entries(breakpoints)) {
    await client.request('setBreakpoints', { source: { path }, breakpoints: fileBreakpoints })
  }
  if (capabilities.exceptionBreakpointFilters) {
    await client.request('setExceptionBreakpoints', { filters: [] })
  }
  if (capabilities.supportsConfigurationDoneRequest) {
    await client.request('configurationDone')
  }
}

/**
 * Runs the DAP launch handshake. Adapters such as debugpy send `initialized` before
 * answering `launch`, so `launch` must stay in flight while breakpoints are configured.
 * The handle is returned immediately because a breakpoint can hit before `launch` answers.
 */
export function startDebugSession(options: StartDebugSessionOptions): DebugSessionHandle {
  const { id, emit } = options
  const client = new DapClient(options.transport)
  let ended = false
  const end = (message?: string): void => {
    if (ended) {
      return
    }
    ended = true
    emit({ kind: 'phase', sessionId: id, phase: 'ended', ...(message ? { message } : {}) })
  }
  client.onEvent((event) => {
    emit({ kind: 'dap-event', sessionId: id, event })
    if (event.event === 'terminated') {
      client.dispose()
    }
  })
  client.onClose(() => end())

  const stop = async (): Promise<void> => {
    if (!ended) {
      await client
        .request('disconnect', { terminateDebuggee: true }, { timeoutMs: DISCONNECT_TIMEOUT_MS })
        .catch(() => {})
    }
    client.dispose()
  }

  const launch = async (): Promise<void> => {
    emit({ kind: 'phase', sessionId: id, phase: 'starting' })
    const capabilities = await client.request('initialize', {
      clientID: 'orca',
      clientName: 'Orca',
      adapterID: options.adapterId,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsRunInTerminalRequest: false
    })
    const initialized = waitForEvent(client, 'initialized', INITIALIZED_TIMEOUT_MS)
    const launched = client.request('launch', options.launchArguments, { timeoutMs: null })
    // Why: either promise may reject while the other is awaited; the race below surfaces it.
    initialized.catch(() => {})
    launched.catch(() => {})
    await Promise.race([initialized, launched.then(() => initialized)])
    await configure(client, isCapabilities(capabilities) ? capabilities : {}, options.breakpoints)
    await launched
    emit({ kind: 'phase', sessionId: id, phase: 'running' })
  }

  const ready = launch().catch(async (error: unknown) => {
    // Why end first: stop() closes the client, whose close handler would end without the reason.
    end(error instanceof Error ? error.message : String(error))
    await stop()
    throw error
  })

  return {
    id,
    ready,
    request: (command, args) => client.request(command, args),
    stop,
    dispose: () => client.dispose()
  }
}
