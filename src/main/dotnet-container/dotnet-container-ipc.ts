import { app, ipcMain } from 'electron'
import { installDotnetContainerLauncher } from './dotnet-container-install'

export function registerDotnetContainerHandlers(): void {
  ipcMain.handle('dotnetContainer:launcherPath', (): Promise<string | null> =>
    installDotnetContainerLauncher(app.getPath('userData'))
  )
}
