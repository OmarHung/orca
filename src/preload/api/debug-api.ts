import type {
  DebugRendererCommand,
  DebugRequestResult,
  DebugSessionEvent,
  DebugStartRequest,
  DebugStartResult
} from '../../shared/debug/debug-session-types'

export type DebugApi = {
  start: (sessionId: string, request: DebugStartRequest) => Promise<DebugStartResult>
  request: (
    sessionId: string,
    command: DebugRendererCommand,
    args?: Record<string, unknown>
  ) => Promise<DebugRequestResult>
  stop: (sessionId: string) => Promise<void>
  /** Whether a loopback port is a debugger endpoint (e.g. a Node inspector), not the program's own. */
  isDebuggerPort: (args: { host: string; port: number }) => Promise<boolean>
  /** Each pid's local terminal (PTY id), or null outside every terminal; for Run/Debug port links. */
  listenerTerminals: (pids: number[]) => Promise<Record<number, string | null>>
  onEvent: (callback: (event: DebugSessionEvent) => void) => () => void
}
