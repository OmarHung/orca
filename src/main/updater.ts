import type { BrowserWindow } from 'electron'
import type {
  LinuxPackageInstallInstructions,
  UpdateCheckOptions,
  UpdateStatus
} from '../shared/update-status-types'
import type {
  RemoteServerUpdateInstallResult,
  RemoteServerUpdaterSnapshot,
  RemoteServerUpdateSupport
} from '../shared/remote-server-update'
import type { ReleaseBuild, ReleaseChannel } from '../shared/release-channel'
import type { ReleaseBuildListOptions } from './updater-release-build-cache'
import { UpdaterSetup, type UpdaterSetupOptions } from './updater/updater-setup'
import type { UpdateInstallMode } from './updater/updater-state'
import {
  getForkSourceUpdater,
  initForkSourceUpdater
} from './fork-source-update/fork-source-update-controller'

// Keep one service instance so all public API calls share updater state and event listeners.
const updater = new UpdaterSetup()

export type { UpdateInstallMode, UpdaterSetupOptions }

export function resolveUpdateInstallMode(isServeMode: boolean): UpdateInstallMode {
  return updater.resolveUpdateInstallMode(isServeMode)
}

export function getUpdateStatus(): UpdateStatus {
  return getForkSourceUpdater()?.getStatus() ?? updater.getUpdateStatus()
}

export function getRemoteServerUpdateSupport(): RemoteServerUpdateSupport {
  return updater.getRemoteServerUpdateSupport()
}

export function getRemoteServerUpdaterSnapshot(runtimeId: string): RemoteServerUpdaterSnapshot {
  return updater.getRemoteServerUpdaterSnapshot(runtimeId)
}

export function checkForRemoteServerUpdate(
  runtimeId: string,
  options?: UpdateCheckOptions
): RemoteServerUpdaterSnapshot {
  return updater.checkForRemoteServerUpdate(runtimeId, options)
}

export function downloadRemoteServerUpdate(runtimeId: string): RemoteServerUpdaterSnapshot {
  return updater.downloadRemoteServerUpdate(runtimeId)
}

export function installRemoteServerUpdate(runtimeId: string): RemoteServerUpdateInstallResult {
  return updater.installRemoteServerUpdate(runtimeId)
}

// Fork builds (see fork-source-update/) route checks, "update", and "install" to the fork updater.
export function checkForUpdates(): void {
  const fork = getForkSourceUpdater()
  if (fork) {
    void fork.check(false)
    return
  }
  updater.checkForUpdates()
}

export function checkForUpdatesFromMenu(options?: UpdateCheckOptions): void {
  const fork = getForkSourceUpdater()
  // Why local-build/pinned options still pass through: those are deliberate manual installs.
  if (fork && !options?.localBuild && !options?.targetTag) {
    void fork.check(true)
    return
  }
  updater.checkForUpdatesFromMenu(options)
}

export function downloadUpdate(): void {
  if (getForkSourceUpdater()?.startSync()) {
    return
  }
  updater.downloadUpdate()
}

export function quitAndInstall(): void {
  if (getForkSourceUpdater()?.install()) {
    return
  }
  updater.quitAndInstall()
}

export function isQuittingForUpdate(): boolean {
  return updater.isQuittingForUpdate()
}

export async function getLinuxPackageInstallInstructions(): Promise<LinuxPackageInstallInstructions> {
  return updater.getLinuxPackageInstallInstructions()
}

export async function showLinuxPackage(): Promise<void> {
  return updater.showLinuxPackage()
}

export async function listAvailableReleaseBuilds(
  channel: ReleaseChannel,
  options?: ReleaseBuildListOptions
): Promise<ReleaseBuild[]> {
  return updater.listAvailableReleaseBuilds(channel, options)
}

export function dismissNudge(): void {
  updater.dismissNudge()
}

export function dismissAvailableUpdate(): void {
  const fork = getForkSourceUpdater()
  if (fork?.ownsActions()) {
    fork.dismiss()
    return
  }
  updater.dismissAvailableUpdate()
}

export function setupAutoUpdater(mainWindow: BrowserWindow, opts?: UpdaterSetupOptions): void {
  initForkSourceUpdater(updater)
  updater.setupAutoUpdater(mainWindow, opts)
}
