import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useProjectHostSetupProjection } from '@/store/selectors'
import { terminalQuickCommandMatchesWorkspaceProject } from '@/lib/terminal-quick-command-project-scope'
import {
  getTerminalQuickCommandScope,
  isTerminalQuickCommandComplete
} from '../../../shared/terminal-quick-commands'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../shared/constants'
import {
  flattenTerminalQuickCommandHosts,
  type HostedTerminalQuickCommand,
  useTerminalQuickCommandHosts
} from './use-terminal-quick-command-hosts'

/** Complete quick commands that apply to one worktree, split by scope. */
export function useWorktreeQuickCommands(worktreeId: string): ReturnType<
  typeof useTerminalQuickCommandHosts
> & {
  repoId: string | null
  repoCommands: HostedTerminalQuickCommand[]
  globalCommands: HostedTerminalQuickCommand[]
} {
  const repos = useAppStore((s) => s.repos)
  const projectHostSetupProjection = useProjectHostSetupProjection()
  const hostState = useTerminalQuickCommandHosts(worktreeId)
  const { executionHostId, hosts } = hostState
  // Why: floating terminals share a synthetic worktree id (`global-floating-terminal`)
  // that has no separator, so naive `getRepoIdFromWorktreeId` would return that
  // sentinel as a "repo id" and the button would point at a repo that doesn't
  // exist. Resolve to a real repo from the workspace; otherwise hide the button.
  const repoId = useMemo(() => {
    if (worktreeId === FLOATING_TERMINAL_WORKTREE_ID) {
      return null
    }
    const candidate = getRepoIdFromWorktreeId(worktreeId)
    return repos.some((r) => r.id === candidate) ? candidate : null
  }, [worktreeId, repos])

  const { repoCommands, globalCommands } = useMemo(() => {
    const repoList: HostedTerminalQuickCommand[] = []
    const globalList: HostedTerminalQuickCommand[] = []
    for (const entry of flattenTerminalQuickCommandHosts(hosts)) {
      const { command } = entry
      if (!isTerminalQuickCommandComplete(command)) {
        continue
      }
      const scope = getTerminalQuickCommandScope(command)
      if (scope.type === 'global') {
        globalList.push(entry)
      } else if (
        scope.type === 'repo' &&
        terminalQuickCommandMatchesWorkspaceProject(command, {
          commandHostId: entry.hostId,
          projectHostSetups: projectHostSetupProjection.setups,
          targetHostId: executionHostId,
          targetRepoId: repoId
        })
      ) {
        repoList.push(entry)
      }
    }
    return { repoCommands: repoList, globalCommands: globalList }
  }, [executionHostId, hosts, projectHostSetupProjection.setups, repoId])

  return { ...hostState, repoId, repoCommands, globalCommands }
}
