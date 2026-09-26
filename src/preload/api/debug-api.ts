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
  onEvent: (callback: (event: DebugSessionEvent) => void) => () => void
}
