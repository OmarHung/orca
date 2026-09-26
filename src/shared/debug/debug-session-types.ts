import type { DebugProtocol } from '@vscode/debugprotocol'

/** Line breakpoints for one file, keyed by absolute path on the execution host. */
export type DebugBreakpointsByFile = Record<string, DebugProtocol.SourceBreakpoint[]>

export type NodePackageManagerName = 'npm' | 'pnpm' | 'yarn' | 'bun'

/** What to debug; each kind maps to one debug adapter. */
export type DebugLaunchTarget =
  | {
      kind: 'python-file'
      /** Absolute path of the Python file. */
      filePath: string
      /** Interpreter the user picked for this project; auto-detected when omitted. */
      pythonPath?: string
    }
  | { kind: 'node-file'; filePath: string }
  | { kind: 'node-script'; packageManager: NodePackageManagerName; script: string }
  | {
      kind: 'dotnet-project'
      /** Absolute path of the .csproj/.fsproj; it is built before debugging. */
      projectFile: string
      /** launchSettings.json profile whose environment and URLs apply. */
      launchProfile?: string
    }

export type DebugStartRequest = {
  worktreeId: string
  /** Absolute working directory for the debugged program. */
  cwd: string
  breakpoints: DebugBreakpointsByFile
  target: DebugLaunchTarget
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
