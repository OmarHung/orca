import { app, ipcMain } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { DotnetContainerStatus } from '../../shared/dotnet-container-types'
import { resolveDockerPath } from '../docker/docker-cli-location'
import {
  dockerRunner,
  readDotnetContainerStatus,
  resetDotnetContainer,
  stopDotnetContainer
} from './dotnet-container-control'
import { dotnetCommandNeedsLauncher } from './dotnet-command-route'
import { dotnetContainerPaths, installDotnetContainerLauncher } from './dotnet-container-install'
import { configureDotnetContainerPorts } from './dotnet-container-ports'

export function registerDotnetContainerHandlers(getSettings: () => GlobalSettings | null): void {
  const userDataPath = app.getPath('userData')
  const { containerName, launcherPath } = dotnetContainerPaths(userDataPath)
  configureDotnetContainerPorts({
    containerName,
    isEnabled: () => getSettings()?.dotnetContainerToolchain === true
  })
  if (getSettings()?.dotnetContainerToolchain === true) {
    // Why: terminals put the launcher on PATH only once its file exists, and an update may change it.
    void installDotnetContainerLauncher(userDataPath).catch((error: unknown) =>
      console.warn('[dotnet-container] Could not install the launcher', error)
    )
  }
  const docker = async () => {
    const path = await resolveDockerPath()
    return path ? dockerRunner(path) : null
  }

  ipcMain.handle('dotnetContainer:launcherPath', (): Promise<string | null> =>
    installDotnetContainerLauncher(userDataPath)
  )
  ipcMain.handle('dotnetContainer:needsLauncher', async (_event, input: unknown) => {
    if (typeof input !== 'object' || input === null || !('cwd' in input) || !('command' in input)) {
      return true
    }
    const { cwd, command } = input
    return typeof cwd === 'string' && typeof command === 'string'
      ? dotnetCommandNeedsLauncher(launcherPath, cwd, command)
      : true
  })
  ipcMain.handle('dotnetContainer:status', async (): Promise<DotnetContainerStatus> =>
    readDotnetContainerStatus(await docker(), containerName)
  )
  ipcMain.handle('dotnetContainer:stop', async (): Promise<void> => {
    const runner = await docker()
    if (runner) {
      await stopDotnetContainer(runner, containerName)
    }
  })
  ipcMain.handle('dotnetContainer:reset', async (): Promise<void> => {
    const runner = await docker()
    if (runner) {
      await resetDotnetContainer(runner, containerName)
    }
  })
}
