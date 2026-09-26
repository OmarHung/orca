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
  /**
   * Opens another connection to the same adapter for `startDebugging` child sessions
   * (js-debug runs each debugged process as a child). Omit for single-session adapters.
   */
  openChildTransport?: () => Promise<DapTransport>
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
 * The DAP handshake for one connection. Adapters such as debugpy send `initialized` before
 * answering `launch`, so `launch` must stay in flight while breakpoints are configured.
 */
async function handshake(
  client: DapClient,
  adapterId: string,
  request: 'launch' | 'attach',
  args: Record<string, unknown>,
  breakpoints: DebugBreakpointsByFile
): Promise<void> {
  const capabilities = await client.request('initialize', {
    clientID: 'orca',
    clientName: 'Orca',
    adapterID: adapterId,
    pathFormat: 'path',
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsVariableType: true,
    supportsRunInTerminalRequest: false,
    supportsStartDebuggingRequest: true
  })
  const initialized = waitForEvent(client, 'initialized', INITIALIZED_TIMEOUT_MS)
  const started = client.request(request, args, { timeoutMs: null })
  // Why: either promise may reject while the other is awaited; the race below surfaces it.
  initialized.catch(() => {})
  started.catch(() => {})
  await Promise.race([initialized, started.then(() => initialized)])
  await configure(client, isRecord(capabilities) ? capabilities : {}, breakpoints)
  await started
}

/**
 * Runs a debug session: the root connection plus any `startDebugging` children. The handle is
 * returned immediately because a breakpoint can hit before `launch` answers.
 */
export function startDebugSession(options: StartDebugSessionOptions): DebugSessionHandle {
  const { id, emit } = options
  const root = new DapClient(options.transport)
  const children: DapClient[] = []
  let breakpoints = options.breakpoints
  // Why: requests without a thread context (threads, stackTrace…) go where the program paused.
  let active: DapClient = root
  let ended = false

  const end = (message?: string): void => {
    if (ended) {
      return
    }
    ended = true
    emit({ kind: 'phase', sessionId: id, phase: 'ended', ...(message ? { message } : {}) })
  }
  const watch = (client: DapClient): void => {
    client.onEvent((event) => {
      emit({ kind: 'dap-event', sessionId: id, event })
      if (event.event === 'stopped') {
        active = client
      } else if (event.event === 'terminated') {
        client.dispose()
      }
    })
  }
  watch(root)
  root.onClose(() => {
    for (const child of children) {
      child.dispose()
    }
    end()
  })

  const startChild = async (request: DebugProtocol.Request): Promise<unknown> => {
    const args = isRecord(request.arguments) ? request.arguments : {}
    const configuration = isRecord(args.configuration) ? args.configuration : {}
    const openTransport = options.openChildTransport
    if (!openTransport) {
      throw new Error('This adapter does not support child sessions')
    }
    const child = new DapClient(await openTransport())
    child.setReverseRequestHandler(handleReverseRequest)
    children.push(child)
    active = child
    watch(child)
    child.onClose(() => {
      children.splice(children.indexOf(child), 1)
      if (active === child) {
        active = children.at(-1) ?? root
      }
    })
    const kind = args.request === 'attach' ? 'attach' : 'launch'
    void handshake(child, options.adapterId, kind, configuration, breakpoints).catch(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        emit({
          kind: 'dap-event',
          sessionId: id,
          event: {
            seq: 0,
            type: 'event',
            event: 'output',
            body: { category: 'stderr', output: `${message}\n` }
          }
        })
      }
    )
    return {}
  }
  // Why every connection: js-debug asks the parent's connection to open nested targets,
  // e.g. `npm run dev` (child) starting `node app.js` (grandchild).
  const handleReverseRequest = async (request: DebugProtocol.Request): Promise<unknown> => {
    if (request.command === 'startDebugging') {
      return startChild(request)
    }
    throw new Error(`Unsupported: ${request.command}`)
  }
  root.setReverseRequestHandler(handleReverseRequest)

  const stop = async (): Promise<void> => {
    if (!ended) {
      await root
        .request('disconnect', { terminateDebuggee: true }, { timeoutMs: DISCONNECT_TIMEOUT_MS })
        .catch(() => {})
    }
    for (const child of children) {
      child.dispose()
    }
    root.dispose()
  }

  const request = async (command: string, args: unknown): Promise<unknown> => {
    if (command !== 'setBreakpoints') {
      return active.request(command, args)
    }
    // Why every connection: breakpoints must reach whichever child ends up running that file.
    const source = isRecord(args) && isRecord(args.source) ? args.source : {}
    if (typeof source.path === 'string' && isRecord(args) && Array.isArray(args.breakpoints)) {
      breakpoints = { ...breakpoints, [source.path]: args.breakpoints }
    }
    const targets = children.length > 0 ? children : [root]
    const results = await Promise.all(targets.map((client) => client.request(command, args)))
    return results[0]
  }

  const ready = (async () => {
    emit({ kind: 'phase', sessionId: id, phase: 'starting' })
    await handshake(root, options.adapterId, 'launch', options.launchArguments, breakpoints)
    emit({ kind: 'phase', sessionId: id, phase: 'running' })
  })().catch(async (error: unknown) => {
    // Why end first: stop() closes the client, whose close handler would end without the reason.
    end(error instanceof Error ? error.message : String(error))
    await stop()
    throw error
  })

  return {
    id,
    ready,
    request,
    stop,
    dispose: () => {
      for (const child of children) {
        child.dispose()
      }
      root.dispose()
    }
  }
}
