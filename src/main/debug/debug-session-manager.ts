import { join } from 'node:path'
import type {
  DebugRequestResult,
  DebugSessionEvent,
  DebugStartRequest,
  DebugStartResult
} from '../../shared/debug/debug-session-types'
import { ensureDebugAdapterInstalled } from './adapters/adapter-installer'
import { DEBUGPY_ARTIFACT } from './adapters/adapter-manifest'
import {
  buildDebugpyAdapterSpawn,
  buildDebugpyLaunchArguments,
  createDebugpyInstallDeps
} from './adapters/debugpy-adapter'
import { isExecutableFile, resolvePythonInterpreter } from '../python/python-interpreters'
import { startStdioDapTransport } from './dap-transport-stdio'
import { startDebugSession, type DebugSessionHandle } from './debug-session'

const MAX_ADAPTER_STDERR_CHARS = 4_000

export type DebugEventSink = {
  send: (event: DebugSessionEvent) => void
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns every live debug session in this process. Local execution only (Phase 0). */
export class DebugSessionManager {
  private readonly sessions = new Map<string, DebugSessionHandle>()

  constructor(private readonly adaptersDir: string) {}

  async start(
    sessionId: string,
    request: DebugStartRequest,
    sink: DebugEventSink
  ): Promise<DebugStartResult> {
    if (this.sessions.has(sessionId)) {
      return { ok: false, message: 'A debug session with this id already exists' }
    }
    if (request.pythonPath && !(await isExecutableFile(request.pythonPath))) {
      return { ok: false, message: `Python interpreter not found: ${request.pythonPath}` }
    }
    const pythonPath = request.pythonPath ?? (await resolvePythonInterpreter(request.cwd))
    if (!pythonPath) {
      return {
        ok: false,
        message: 'No Python interpreter found (looked for .venv, venv, then python3 on PATH)'
      }
    }
    let debugpyDir: string
    try {
      sink.send({ kind: 'phase', sessionId, phase: 'installing-adapter' })
      debugpyDir = await ensureDebugAdapterInstalled(
        DEBUGPY_ARTIFACT,
        this.adaptersDir,
        createDebugpyInstallDeps(pythonPath)
      )
    } catch (error) {
      const message = `Could not install debugpy: ${errorMessage(error)}`
      sink.send({ kind: 'phase', sessionId, phase: 'ended', message })
      return { ok: false, message }
    }

    let stderr = ''
    const spawn = buildDebugpyAdapterSpawn(pythonPath, debugpyDir)
    const session = startDebugSession({
      id: sessionId,
      adapterId: 'debugpy',
      transport: startStdioDapTransport({
        ...spawn,
        cwd: request.cwd,
        onStderr: (text) => {
          stderr = (stderr + text).slice(-MAX_ADAPTER_STDERR_CHARS)
        }
      }),
      launchArguments: buildDebugpyLaunchArguments({
        filePath: request.filePath,
        cwd: request.cwd,
        pythonPath
      }),
      breakpoints: request.breakpoints,
      emit: (event) => {
        if (event.kind === 'phase' && event.phase === 'ended') {
          this.sessions.delete(sessionId)
        }
        sink.send(event)
      }
    })
    this.sessions.set(sessionId, session)
    try {
      await session.ready
      return { ok: true, sessionId }
    } catch (error) {
      const detail = stderr.trim()
        ? `${errorMessage(error)}\n${stderr.trim()}`
        : errorMessage(error)
      return { ok: false, message: detail }
    }
  }

  async request(sessionId: string, command: string, args: unknown): Promise<DebugRequestResult> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return { ok: false, message: 'Debug session is no longer running' }
    }
    try {
      return { ok: true, body: await session.request(command, args) }
    } catch (error) {
      return { ok: false, message: errorMessage(error) }
    }
  }

  async stop(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.stop()
  }

  disposeAll(): void {
    for (const session of this.sessions.values()) {
      session.dispose()
    }
    this.sessions.clear()
  }
}

export function defaultDebugAdaptersDir(userDataDir: string): string {
  return join(userDataDir, 'debug-adapters')
}
