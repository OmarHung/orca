import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { stopDebugSession } from '../debug/debug-session-controller'
import { useDebugStore, type DebugSessionView } from '../debug/debug-store'
import {
  liveRunSession,
  stopConfigurationAndWait,
  type RunTarget
} from './run-configuration-control'
import { isRunSessionActive } from './run-session-store'

/** What a launch needs to know to keep one item from running and debugging at once. */
export type RunDebugLaunchContext = {
  worktreeId: string
  /** The Run widget item being launched. */
  sourceKey: string
  label: string
  confirm: ConfirmationDialogContextValue
}

export function isDebuggingSource(
  session: DebugSessionView | null,
  worktreeId: string,
  sourceKey: string
): boolean {
  return (
    session !== null &&
    session.phase !== 'ended' &&
    session.worktreeId === worktreeId &&
    session.sourceKey === sourceKey
  )
}

/** Resolves false when the user keeps the debug session; otherwise stops it so the run can start. */
export async function stopDebuggingBeforeRun(context: RunDebugLaunchContext): Promise<boolean> {
  const session = useDebugStore.getState().session
  if (!isDebuggingSource(session, context.worktreeId, context.sourceKey)) {
    return true
  }
  const confirmed = await context.confirm({
    title: translate('run.exclusive.debugging.title', "'{{value0}}' is being debugged", {
      value0: context.label
    }),
    description: translate(
      'run.exclusive.debugging.description',
      'Only one instance can run at a time. Stop debugging and run it instead?'
    ),
    confirmLabel: translate('run.exclusive.debugging.confirm', 'Stop and Run')
  })
  if (confirmed) {
    await stopDebugSession()
  }
  return confirmed
}

/** Resolves false when the user keeps the run; otherwise stops it so the debug session can start. */
export async function stopRunBeforeDebug(
  context: RunDebugLaunchContext,
  target: RunTarget | null
): Promise<boolean> {
  const session = target ? liveRunSession(target.worktreeId, target.commandKey) : null
  if (!target || !session || !isRunSessionActive(session.status)) {
    return true
  }
  const confirmed = await context.confirm({
    title: translate('run.exclusive.running.title', "'{{value0}}' is running", {
      value0: context.label
    }),
    description: translate(
      'run.exclusive.running.description',
      'Only one instance can run at a time. Stop it and debug it instead?'
    ),
    confirmLabel: translate('run.exclusive.running.confirm', 'Stop and Debug')
  })
  if (confirmed) {
    await stopConfigurationAndWait(target)
  }
  return confirmed
}
