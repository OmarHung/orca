import { useAppStore } from '@/store'
import { buildProjectInitialTabStartup } from '@/lib/project-initial-tab-startup'
import { ensureWorktreeHasInitialTerminal } from '@/lib/worktree-initial-terminal-seeding'

/** Opens the project's initial agent tab in an empty workspace; false means the caller seeds a shell. */
export function seedProjectInitialAgentTab(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const startup = buildProjectInitialTabStartup(state, worktreeId)
  if (!startup) {
    return false
  }
  return ensureWorktreeHasInitialTerminal(state, worktreeId, startup) !== null
}
