import { readThreadIds } from './debug-protocol-readers'
import { dapRequest, reportDebugError } from './debug-request'
import { markDebugSessionRunning } from './debug-session-controller'
import { findDebugSession, useDebugStore } from './debug-store'

type ThreadCommand = 'continue' | 'next' | 'stepIn' | 'stepOut'

function threadCommand(sessionId: string, command: ThreadCommand): void {
  const session = findDebugSession(useDebugStore.getState().sessions, sessionId)
  const threadId = session?.stoppedThreadId
  if (threadId === null || threadId === undefined) {
    return
  }
  markDebugSessionRunning(sessionId)
  dapRequest(sessionId, command, { threadId }).catch((error: unknown) =>
    reportDebugError(sessionId, error)
  )
}

export const debugContinue = (sessionId: string): void => threadCommand(sessionId, 'continue')
export const debugStepOver = (sessionId: string): void => threadCommand(sessionId, 'next')
export const debugStepInto = (sessionId: string): void => threadCommand(sessionId, 'stepIn')
export const debugStepOut = (sessionId: string): void => threadCommand(sessionId, 'stepOut')

export async function debugPause(sessionId: string): Promise<void> {
  try {
    const threadId = readThreadIds(await dapRequest(sessionId, 'threads'))[0]
    if (threadId !== undefined) {
      await dapRequest(sessionId, 'pause', { threadId })
    }
  } catch (error) {
    reportDebugError(sessionId, error)
  }
}
