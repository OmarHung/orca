import { join } from 'node:path'
import { isDirectory } from '../claude-profile-homes'
// Keep the router setup graph out of scan workers.
import type { ClaudeProfileRouter } from './claude-profile-router'
import type { ClaudeWslProfileRouter } from '../wsl/claude-profile-wsl-router'
import type { ClaudeAccountSelectionTarget } from '../../selection/runtime-selection'
import type { ClaudeObservedConfigDirs } from './claude-observed-config-dirs'
import type { ClaudeLaunchProject } from '../../../../shared/agent-accounts/claude/claude-project-account'
import type { Repo } from '../../../../shared/repository/repo-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID
} from '../../../../shared/execution-host/execution-host'

let installed: ClaudeProfileRouter | undefined

/** Installed only in the desktop process. */
export function installClaudeProfileRouter(router: ClaudeProfileRouter | undefined): void {
  installed = router
}

export function getClaudeProfileRouter(): ClaudeProfileRouter | undefined {
  return installed
}

let installedObserved: ClaudeObservedConfigDirs | undefined

export function installClaudeObservedConfigDirs(dirs: ClaudeObservedConfigDirs | undefined): void {
  installedObserved = dirs
}

export function getClaudeObservedConfigDirs(): ClaudeObservedConfigDirs | undefined {
  return installedObserved
}

let installedWsl: ClaudeWslProfileRouter | undefined

export function installClaudeWslProfileRouter(router: ClaudeWslProfileRouter | undefined): void {
  installedWsl = router
}

export function getClaudeWslProfileRouter(): ClaudeWslProfileRouter | undefined {
  return installedWsl
}

export function withClaudeProfileTerminalEnv<Env extends Record<string, string> | undefined>(
  env: Env,
  target: ClaudeAccountSelectionTarget,
  project?: ClaudeLaunchProject
): Env | Record<string, string> {
  const profileEnv = installed?.terminalEnv(target, project)
  return profileEnv ? { ...env, ...profileEnv } : env
}

/** A project's own account changed: re-point its open terminals. A failure must not undo the save. */
export function publishClaudeProjectAccount(
  repo: Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>
): void {
  if (getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
    return
  }
  try {
    installed?.publish({ repoId: repo.id })
  } catch (error) {
    console.warn('[claude-profile] Could not re-point the project Claude account:', error)
  }
}

/** The user's CLAUDE_CONFIG_DIR from the login shell, folders Orca saw Claude use, and account homes. */
export function claudeProfileHistoryDirs(surface: 'projects' | 'transcripts'): string[] {
  const homes = [
    installed?.userConfigDir(),
    ...(installedObserved?.list() ?? []),
    ...(installed?.accountHomes() ?? [])
  ].filter((home): home is string => Boolean(home))
  const dirs = homes.map((home) => join(home, surface)).filter(isDirectory)
  return dirs.filter((dir, index) => dirs.indexOf(dir) === index)
}
