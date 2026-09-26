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
import { applyDebugLaunchOptions } from './debug-launch-options'

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
    case 'python-module':
      return prepareDebugpy(context, { module: target.module, pythonPath: target.pythonPath })
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
    case 'dotnet-program':
      return prepareNetcoredbg(context, { program: target.program })
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
  /** Sessions still preparing their adapter (which can include a download), by their event sink. */
  private readonly preparing = new Map<string, DebugEventSink>()
  /** Preparing sessions whose stop arrived early; already reported ended, they never launch. */
  private readonly stoppedWhilePreparing = new Set<string>()

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
    this.preparing.set(sessionId, sink)
    // Why: once stopped, the session has ended for the renderer; later progress must not revive it.
    const sendWhileLive = (event: DebugSessionEvent): void => {
      if (!this.stoppedWhilePreparing.has(sessionId)) {
        sink.send(event)
      }
    }
    try {
      prepared = await prepareAdapter(request.target, {
        adaptersDir: this.adaptersDir,
        cwd: request.cwd,
        onInstalling: () =>
          sendWhileLive({ kind: 'phase', sessionId, phase: 'installing-adapter' }),
        onOutput: (output, category) =>
          sendWhileLive({
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
      sendWhileLive({ kind: 'phase', sessionId, phase: 'ended', message })
      this.preparing.delete(sessionId)
      this.stoppedWhilePreparing.delete(sessionId)
      return { ok: false, message }
    }

    const paths = new DebugPathMapping()
    let breakpoints: DebugStartRequest['breakpoints']
    try {
      breakpoints = await paths.breakpointsToAdapter(request.breakpoints)
    } finally {
      // Why here: from now until the session is in the map there is no await, so a stop
      // either lands in the check below or finds the live session.
      this.preparing.delete(sessionId)
    }
    if (this.stoppedWhilePreparing.delete(sessionId)) {
      prepared.dispose()
      return { ok: false, message: 'The debug session was stopped before it started' }
    }
    const session = startDebugSession({
      id: sessionId,
      adapterId: prepared.adapterId,
      transport: prepared.transport,
      ...(prepared.openChildTransport ? { openChildTransport: prepared.openChildTransport } : {}),
      launchArguments: applyDebugLaunchOptions(prepared.launchArguments, request.launchOptions),
      breakpoints,
      ...(request.exceptionFilters ? { exceptionFilters: request.exceptionFilters } : {}),
      onCapabilities: (capabilities) =>
        sink.send({
          kind: 'capabilities',
          sessionId,
          adapterId: prepared.adapterId,
          exceptionFilters: (capabilities.exceptionBreakpointFilters ?? []).map((option) => ({
            filter: option.filter,
            label: option.label,
            ...(option.default ? { default: true } : {})
          }))
        }),
      emit: (event) => {
        if (event.kind === 'phase' && event.phase === 'ended') {
          this.sessions.delete(sessionId)
          prepared.dispose()
        }
        sink.send(
          event.kind === 'dap-event'
            ? { ...event, event: paths.eventFromAdapter(event.event) }
            : event
        )
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
    // Why: the session is not in the map until its adapter is ready, so a stop pressed during
    // that window would otherwise be dropped and the program would launch anyway.
    const preparingSink = this.preparing.get(sessionId)
    if (preparingSink) {
      // Why report now: preparing can be a long download, and the stop should show at once.
      if (!this.stoppedWhilePreparing.has(sessionId)) {
        this.stoppedWhilePreparing.add(sessionId)
        preparingSink.send({ kind: 'phase', sessionId, phase: 'ended' })
      }
      return
    }
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
