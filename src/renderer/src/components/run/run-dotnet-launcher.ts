import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { flattenTerminalQuickCommand } from '../../../../shared/terminal-quick-commands'
import { isLocalDebugTarget } from '../debug/debug-launch'
import { routeDotnetCommand, startsWithDotnet } from './dotnet-command-route'
import { useDotnetContainerStore } from './dotnet-container-store'
import type { RunTarget } from './run-target'

// Why: the container runs on this machine; SSH, WSL and remote-runtime runs use their own dotnet.
function runsOnThisMachine(worktreeId: string): boolean {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  const repo = worktree ? state.repos.find((candidate) => candidate.id === worktree.repoId) : null
  return Boolean(
    worktree &&
    repo &&
    isLocalDebugTarget({
      repoHostId: getRepoExecutionHostId(repo),
      activeRuntimeIsLocal: getActiveRuntimeTarget(state.settings).kind === 'local',
      worktreePath: worktree.path
    })
  )
}

function plainCommandText(target: RunTarget): string {
  return flattenTerminalQuickCommand(target.command).command
}

/**
 * Writes the launcher before a run that will type it. Null when there is nothing to wait for,
 * so callers keep their synchronous launch (and Rerun its immediate Ctrl-C) in the common case.
 */
export function prepareDotnetLauncher(target: RunTarget): Promise<unknown> | null {
  return useDotnetContainerStore.getState().enabled &&
    startsWithDotnet(plainCommandText(target)) &&
    runsOnThisMachine(target.worktreeId)
    ? useDotnetContainerStore.getState().loadLauncherPath()
    : null
}

/** The command line a run types into its terminal. */
export function runCommandText(target: RunTarget): string {
  const command = plainCommandText(target)
  const { enabled, launcherPath } = useDotnetContainerStore.getState()
  return enabled && launcherPath && runsOnThisMachine(target.worktreeId)
    ? routeDotnetCommand(
        command,
        launcherPath,
        useAppStore.getState().settings?.terminalDefaultShell ?? ''
      )
    : command
}
