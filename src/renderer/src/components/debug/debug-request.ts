import type { DebugRendererCommand } from '../../../../shared/debug/debug-session-types'
import { translate } from '@/i18n/i18n'
import { useDebugStore } from './debug-store'

export function currentSessionId(): string | null {
  const session = useDebugStore.getState().session
  return session && session.phase !== 'ended' ? session.id : null
}

/** Sends one DAP request to the running session; throws with the adapter's message on failure. */
export async function dapRequest(
  command: DebugRendererCommand,
  args: Record<string, unknown> = {}
): Promise<unknown> {
  const sessionId = currentSessionId()
  if (!sessionId) {
    throw new Error(translate('debug.noSession', 'No debug session is running'))
  }
  const result = await window.api.debug.request(sessionId, command, args)
  if (!result.ok) {
    throw new Error(result.message)
  }
  return result.body
}

export function reportDebugError(error: unknown): void {
  useDebugStore.getState().setLastError(error instanceof Error ? error.message : String(error))
}
