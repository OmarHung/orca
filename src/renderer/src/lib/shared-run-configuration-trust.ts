import type { AppState } from '@/store/types'
import type { ExecutionHostId } from '../../../shared/execution-host'
import {
  confirmScriptContent,
  enqueueTrustPrompt
} from '../runtime/repo-hooks/ensure-hooks-confirmed'

/** Asks once per content change before any orca.yaml run configuration may execute. */
export function confirmSharedRunConfigurations(
  state: AppState,
  repoId: string,
  trustContent: string,
  hostId?: ExecutionHostId
): Promise<'run' | 'skip'> {
  return enqueueTrustPrompt(() =>
    confirmScriptContent(state, repoId, 'runConfigurations', trustContent, hostId)
  ).then((approval) => approval.decision)
}
