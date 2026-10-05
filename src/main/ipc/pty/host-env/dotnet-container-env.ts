import { existsSync } from 'node:fs'
import { delimiter } from 'node:path'
import { dotnetContainerPaths } from '../../../dotnet-container/dotnet-container-install'
import { resolvePathEnvKey } from '../../../pty/windows-environment-path'
import { readInheritedPath } from './path'

export const DOTNET_LAUNCHER_DIR_ENV = 'ORCA_DOTNET_LAUNCHER_DIR'

/**
 * Puts the .NET container launcher first on a local terminal's PATH and names its folder, so the
 * shell-ready wrappers can put it back after rc files that prepend ~/.dotnet. The launcher sends
 * only .NET 5-and-older projects to the container; every other `dotnet` reaches the native SDK.
 */
export function applyDotnetContainerLauncherEnv(
  env: Record<string, string>,
  options: { dotnetContainerToolchain?: boolean; userDataPath: string; isWsl?: boolean },
  platform: NodeJS.Platform = process.platform
): void {
  // Why: an inherited copy (Orca started from an Orca pane) names another launch's launcher.
  const inheritedDir = env[DOTNET_LAUNCHER_DIR_ENV]
  delete env[DOTNET_LAUNCHER_DIR_ENV]
  if (options.isWsl === true || platform === 'win32') {
    return
  }
  const { binDir, launcherPath } = dotnetContainerPaths(options.userDataPath)
  const enabled = options.dotnetContainerToolchain === true && existsSync(launcherPath)
  const pathKey = resolvePathEnvKey(env, platform)
  const entries = readInheritedPath(env, platform).split(delimiter)
  const kept = entries.filter(
    (entry) => entry.length > 0 && entry !== binDir && entry !== inheritedDir
  )
  if (enabled) {
    env[DOTNET_LAUNCHER_DIR_ENV] = binDir
    env[pathKey] = [binDir, ...kept].join(delimiter)
  } else if (kept.length !== entries.filter((entry) => entry.length > 0).length) {
    // Why: with the toggle off, a launcher left on PATH would still route `dotnet` to a container.
    env[pathKey] = kept.join(delimiter)
  }
}
