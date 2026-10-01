import type { DebugRendererCommand } from '../../../../shared/debug/debug-session-types'
import { translate } from '@/i18n/i18n'
import { findDebugSession, isLiveDebugSession, useDebugStore } from './debug-store'

export function isLiveSessionId(sessionId: string | null | undefined): sessionId is string {
  const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
  return session !== null && isLiveDebugSession(session)
}

/** Sends one DAP request to a running session; throws with the adapter's message on failure. */
export async function dapRequest(
  sessionId: string,
  command: DebugRendererCommand,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  if (!isLiveSessionId(sessionId)) {
    throw new Error(translate('debug.noSession', 'No debug session is running'))
  }
  const result = await window.api.debug.request(sessionId, command, args)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.body
}

export function reportDebugError(sessionId: string, error: unknown): void {
  useDebugStore
    .getState()
    .setLastError(sessionId, error instanceof Error ? error.message : String(error))
}
