import { join } from 'node:path'
import type {
  DebugRequestResult,
  DebugSessionEvent,
  DebugLaunchTarget,
  DebugStartRequest,
  DebugStartResult
} from '../../shared/debug/debug-session-types'
import { prepareDebugpy } from './adapters/debugpy-launch'
import { prepareJsDebug } from './adapters/js-debug-launch'
import { prepareNetcoredbg } from './adapters/netcoredbg-launch'
import {
  DebugPreparationError,
  type AdapterPreparation,
  type PreparedDebugAdapter
} from './adapters/prepared-debug-adapter'
import { startDebugSession, type DebugSessionHandle } from './debug-session'
import { DebugPathMapping } from './debug-path-mapping'

export type DebugEventSink = {
  send: (event: DebugSessionEvent) => void
}

function prepareAdapter(
  target: DebugLaunchTarget,
  context: AdapterPreparation
): Promise<PreparedDebugAdapter> {
  switch (target.kind) {
    case 'python-file':
      return prepareDebugpy(context, target)
    case 'node-file':
      return prepareJsDebug(context, { kind: 'file', filePath: target.filePath })
    case 'node-script':
      return prepareJsDebug(context, {
        kind: 'script',
        packageManager: target.packageManager,
        script: target.script
      })
    case 'dotnet-project':
      return prepareNetcoredbg(context, target)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns every live debug session in this process. Local execution only. */
export class DebugSessionManager {
  private readonly sessions = new Map<
    string,
    { session: DebugSessionHandle; paths: DebugPathMapping }
  >()

  constructor(private readonly adaptersDir: string) {}

  async start(
    sessionId: string,
    request: DebugStartRequest,
    sink: DebugEventSink
  ): Promise<DebugStartResult> {
    if (this.sessions.has(sessionId)) {
      return { ok: false, message: 'A debug session with this id already exists' }
    }
    let prepared: PreparedDebugAdapter
    try {
      prepared = await prepareAdapter(request.target, {
        adaptersDir: this.adaptersDir,
        cwd: request.cwd,
        onInstalling: () => sink.send({ kind: 'phase', sessionId, phase: 'installing-adapter' }),
        onOutput: (output, category) =>
          sink.send({
            kind: 'dap-event',
            sessionId,
            event: { seq: 0, type: 'event', event: 'output', body: { category, output } }
          })
      })
    } catch (error) {
      const message =
        error instanceof DebugPreparationError
          ? error.message
          : `Could not start the debugger: ${errorMessage(error)}`
      sink.send({ kind: 'phase', sessionId, phase: 'ended', message })
      return { ok: false, message }
    }

    const paths = new DebugPathMapping()
    const session = startDebugSession({
      id: sessionId,
      adapterId: prepared.adapterId,
      transport: prepared.transport,
      ...(prepared.openChildTransport ? { openChildTransport: prepared.openChildTransport } : {}),
      launchArguments: prepared.launchArguments,
      breakpoints: await paths.breakpointsToAdapter(request.breakpoints),
      emit: (event) => {
        if (event.kind === 'phase' && event.phase === 'ended') {
          this.sessions.delete(sessionId)
          prepared.dispose()
        }
        sink.send(event)
      }
    })
    this.sessions.set(sessionId, { session, paths })
    try {
      await session.ready
      return { ok: true, sessionId }
    } catch (error) {
      const diagnostics = prepared.diagnostics()
      return {
        ok: false,
        message: diagnostics ? `${errorMessage(error)}\n${diagnostics}` : errorMessage(error)
      }
    }
  }

  async request(sessionId: string, command: string, args: unknown): Promise<DebugRequestResult> {
    const live = this.sessions.get(sessionId)
    if (!live) {
      return { ok: false, message: 'Debug session is no longer running' }
    }
    try {
      const body = await live.session.request(
        command,
        await live.paths.requestToAdapter(command, args)
      )
      return { ok: true, body: live.paths.responseFromAdapter(command, body) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async stop(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.session.stop()
  }

  disposeAll(): void {
    for (const { session } of this.sessions.values()) {
      session.dispose()
    }
    this.sessions.clear()
  }
}

export function defaultDebugAdaptersDir(userDataDir: string): string {
  return join(userDataDir, 'debug-adapters')
}
