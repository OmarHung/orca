import { accessSync, chmodSync, constants, readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { resolveDockerPath } from '../docker/docker-cli-location'
import { dockerInstanceTag } from '../docker/docker-instance-tag'
import { writeShellWrapperFiles } from '../shell-wrapper-file-writer'
import type { DotnetContainerArch } from './dotnet-container-downloads'
import { buildDotnetContainerDockerfile, dotnetContainerImageTag } from './dotnet-container-image'
import { buildDotnetContainerLauncher } from './dotnet-container-launcher'
import { dotnetContainerRun } from './dotnet-container-run'

export type DotnetContainerHost = {
  platform: NodeJS.Platform
  arch: string
  home: string
  uid: number
  gid: number
  timeZone: string | null
  resolveDocker: () => Promise<string | null>
}

function currentHost(): DotnetContainerHost {
  const user = os.userInfo()
  return {
    platform: process.platform,
    arch: process.arch,
    home: os.homedir(),
    uid: user.uid,
    gid: user.gid,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    resolveDocker: resolveDockerPath
  }
}

function containerArch(arch: string): DotnetContainerArch | null {
  return arch === 'arm64' ? 'arm64' : arch === 'x64' ? 'x64' : null
}

/** Folders mounted at the same path inside the container; `docker run --volume` splits on ':'. */
function sharedFolders(host: DotnetContainerHost): string[] | null {
  const folders = host.platform === 'darwin' ? [host.home, '/Volumes'] : [host.home]
  return folders.some((folder) => folder.includes(':')) ? null : folders
}

function isCurrent(path: string, content: string, executable: boolean): boolean {
  try {
    if (readFileSync(path, 'utf8') !== content) {
      return false
    }
    if (executable) {
      accessSync(path, constants.X_OK)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Writes the `dotnet` launcher Orca's runs call for legacy .NET, and the Dockerfile it builds
 * from. Null where the container cannot run: Windows (no same-path mounts) or another CPU.
 */
export async function installDotnetContainerLauncher(
  userDataPath: string,
  host: DotnetContainerHost = currentHost()
): Promise<string | null> {
  const arch = containerArch(host.arch)
  const mounts = sharedFolders(host)
  if ((host.platform !== 'darwin' && host.platform !== 'linux') || !arch || !mounts) {
    return null
  }
  const dir = join(userDataPath, 'dotnet-container')
  const dockerfilePath = join(dir, 'Dockerfile')
  const launcherPath = join(dir, 'dotnet')
  const dockerfile = buildDotnetContainerDockerfile(arch)
  const image = dotnetContainerImageTag(dockerfile)
  const instanceTag = dockerInstanceTag(userDataPath)
  const containerName = `orca-dotnet-${instanceTag}`
  const platform = arch === 'arm64' ? 'linux/arm64' : 'linux/amd64'
  const launcher = buildDotnetContainerLauncher({
    // Why fall back to a bare name: Docker installed after Orca started is then still found.
    dockerPath: (await host.resolveDocker()) ?? 'docker',
    containerName,
    image,
    dockerfilePath,
    platform,
    mounts,
    run: dotnetContainerRun({
      containerName,
      image,
      platform,
      instanceTag,
      uid: host.uid,
      gid: host.gid,
      home: host.home,
      timeZone: host.timeZone,
      mounts
    }),
    dockerDesktopSettingsPath:
      host.platform === 'darwin'
        ? join(host.home, 'Library', 'Group Containers', 'group.com.docker', 'settings-store.json')
        : null,
    httpsCertificateDir: join(dir, 'https')
  })
  // Why skip unchanged files: a run may be starting the launcher while another call rewrites it.
  if (isCurrent(dockerfilePath, dockerfile, false) && isCurrent(launcherPath, launcher, true)) {
    return launcherPath
  }
  const written = writeShellWrapperFiles(
    [
      [dockerfilePath, dockerfile],
      [launcherPath, launcher]
    ],
    '[dotnet-container]',
    '.NET runs keep using the native SDK'
  )
  if (!written) {
    return null
  }
  chmodSync(launcherPath, 0o755)
  return launcherPath
}
