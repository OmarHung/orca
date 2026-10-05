import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getActiveRuntimeTarget } from '@/runtime/runtime-client-target'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { flattenTerminalQuickCommand } from '../../../../shared/terminal-quick-commands'
import { isLocalDebugTarget } from '../debug/debug-launch'
import { invokePath, routeDotnetCommand, startsWithDotnet } from './dotnet-command-route'
import { isDotnetContainerEnabled, useDotnetContainerStore } from './dotnet-container-store'
import type { RunTarget } from './run-target'

// Why: the container runs on this machine; SSH, WSL and remote-runtime runs use their own dotnet.
export function runsOnThisMachine(worktreeId: string): boolean {
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

/** Whether each run's latest command needs the launcher; a run with no answer gets it. */
const needsLauncherByRun = new Map<string, boolean>()

function runKey(target: RunTarget): string {
  return `${target.worktreeId}\0${target.commandKey}`
}

function plainCommandText(target: RunTarget): string {
  return flattenTerminalQuickCommand(target.command).command
}

function runDirectory(target: RunTarget): string | null {
  const worktree = findWorktreeById(useAppStore.getState().worktreesByRepo, target.worktreeId)
  if (!worktree || !target.cwd) {
    return worktree?.path ?? null
  }
  // Why '/': the container only runs on macOS and Linux.
  return target.cwd.startsWith('/') ? target.cwd : joinPath(worktree.path, target.cwd)
}

async function prepareDotnetRoute(target: RunTarget): Promise<void> {
  const launcherPath = await useDotnetContainerStore.getState().loadLauncherPath()
  const cwd = runDirectory(target)
  // Why ask: only .NET 5-and-older projects need the launcher; the rest keep their plain command.
  const needsLauncher =
    launcherPath && cwd
      ? await window.api.dotnetContainer
          .needsLauncher({ cwd, command: plainCommandText(target) })
          .catch(() => true)
      : true
  needsLauncherByRun.set(runKey(target), needsLauncher)
}

/**
 * Writes the launcher and decides whether a run needs it, before the run types its command. Null
 * when there is nothing to wait for, so callers keep their synchronous launch (and Rerun its
 * immediate Ctrl-C) in the common case.
 */
export function prepareDotnetLauncher(target: RunTarget): Promise<unknown> | null {
  return isDotnetContainerEnabled() &&
    startsWithDotnet(plainCommandText(target)) &&
    runsOnThisMachine(target.worktreeId)
    ? prepareDotnetRoute(target)
    : null
}

/** The command line a run types into its terminal. */
export function runCommandText(target: RunTarget): string {
  const command = plainCommandText(target)
  const { launcherPath } = useDotnetContainerStore.getState()
  return isDotnetContainerEnabled() &&
    launcherPath &&
    needsLauncherByRun.get(runKey(target)) !== false &&
    runsOnThisMachine(target.worktreeId)
    ? routeDotnetCommand(
        command,
        launcherPath,
        useAppStore.getState().settings?.terminalDefaultShell ?? ''
      )
    : command
}

/** Opens a terminal tab running a shell inside the container, in the workspace folder. */
export async function openDotnetContainerShell(
  worktreeId: string,
  groupId: string | null
): Promise<boolean> {
  const launcherPath = await useDotnetContainerStore.getState().loadLauncherPath()
  if (!launcherPath || !runsOnThisMachine(worktreeId)) {
    return false
  }
  const shell = useAppStore.getState().settings?.terminalDefaultShell ?? ''
  useAppStore.getState().createTab(worktreeId, groupId ?? undefined, undefined, {
    activate: true,
    quickCommandLabel: '.NET container',
    pendingStartup: { command: `${invokePath(launcherPath, shell)} --orca-shell` }
  })
  return true
}
