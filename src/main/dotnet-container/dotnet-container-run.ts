import { createHash } from 'node:crypto'
import { posix } from 'node:path'

export const DOTNET_CONTAINER_LABEL = 'dev.orca.dotnet-container'
export const DOTNET_CONTAINER_CONFIG_LABEL = `${DOTNET_CONTAINER_LABEL}.config`

export type DotnetContainerRunInput = {
  containerName: string
  image: string
  platform: string
  instanceTag: string
  uid: number
  gid: number
  home: string
  timeZone: string | null
  mounts: readonly string[]
}

export type DotnetContainerRun = {
  /** `docker run` argv for the long-lived container every legacy `dotnet` call is exec'd into. */
  args: string[]
  /** Hash of everything the container is created with; a running one with another hash is stale. */
  config: string
}

export function dotnetContainerRun(input: DotnetContainerRunInput): DotnetContainerRun {
  const settings = [
    '--platform',
    input.platform,
    // Why host: launchSettings and connection strings say `localhost`, meaning the Mac.
    '--network',
    'host',
    // Why: netcoredbg attaches to the programs it launches.
    '--cap-add',
    'SYS_PTRACE',
    '--user',
    `${input.uid}:${input.gid}`,
    '--env',
    `HOME=${input.home}`,
    '--env',
    `NUGET_PACKAGES=${posix.join(input.home, '.nuget', 'packages')}`,
    ...(input.timeZone ? ['--env', `TZ=${input.timeZone}`] : []),
    // Why the same paths: build output, PDBs and debugger paths then need no translation.
    ...input.mounts.flatMap((mount) => ['--volume', `${mount}:${mount}`]),
    input.image
  ]
  const config = createHash('sha256').update(JSON.stringify(settings)).digest('hex').slice(0, 12)
  return {
    config,
    args: [
      'run',
      '--detach',
      '--init',
      '--name',
      input.containerName,
      '--label',
      `${DOTNET_CONTAINER_LABEL}=1`,
      '--label',
      `${DOTNET_CONTAINER_LABEL}.instance=${input.instanceTag}`,
      '--label',
      `${DOTNET_CONTAINER_CONFIG_LABEL}=${config}`,
      ...settings,
      'sleep',
      'infinity'
    ]
  }
}
