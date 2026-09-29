import type { GitHistoryResult } from '../../../../../shared/git-history'
import type { GitHistoryPanelState } from '../../right-sidebar/source-control/sync/git-history-panel'

/** State while a load is in flight. A silent (automatic) reload keeps what is shown untouched. */
export function startGitLogLoad(
  previous: GitHistoryPanelState | undefined,
  silent: boolean
): GitHistoryPanelState {
  if (!previous?.result) {
    return { status: 'loading' }
  }
  return silent ? previous : { status: 'refreshing', result: previous.result }
}

/** State after a load; returns `previous` itself when nothing changed so the log doesn't re-render. */
export function finishGitLogLoad(
  previous: GitHistoryPanelState | undefined,
  result: GitHistoryResult
): GitHistoryPanelState {
  if (previous?.status === 'ready' && isSameGitLogPayload(previous.result, result)) {
    return previous
  }
  return { status: 'ready', result }
}

// Why: history crosses IPC as plain JSON, so its serialization is a complete equality check.
export function isSameGitLogPayload<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}
