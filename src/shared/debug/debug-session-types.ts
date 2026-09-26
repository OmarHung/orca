import type { DebugProtocol } from '@vscode/debugprotocol'

/** Line breakpoints for one file, keyed by absolute path on the execution host. */
export type DebugBreakpointsByFile = Record<string, DebugProtocol.SourceBreakpoint[]>

export type DebugStartRequest = {
  worktreeId: string
  /** Absolute path of the Python file to run under the debugger. */
  filePath: string
  cwd: string
  breakpoints: DebugBreakpointsByFile
}

export type DebugStartResult = { ok: true; sessionId: string } | { ok: false; message: string }

export type DebugSessionPhase = 'installing-adapter' | 'starting' | 'running' | 'ended'

export type DebugSessionEvent =
  | { kind: 'phase'; sessionId: string; phase: DebugSessionPhase; message?: string }
  | { kind: 'dap-event'; sessionId: string; event: DebugProtocol.Event }

/** DAP requests the renderer may send to a running session. */
export const DEBUG_RENDERER_COMMANDS = [
  'threads',
  'stackTrace',
  'scopes',
  'variables',
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'pause',
  'setBreakpoints',
  'evaluate'
] as const

export type DebugRendererCommand = (typeof DEBUG_RENDERER_COMMANDS)[number]

export type DebugRequestResult = { ok: true; body: unknown } | { ok: false; message: string }
