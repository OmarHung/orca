import type { DotnetContainerStatus } from '../../shared/dotnet-container-types'

export type DotnetContainerApi = {
  /** The `dotnet` launcher that sends pre-.NET 6 projects to Orca's container; null where unsupported. */
  launcherPath: () => Promise<string | null>
  /** Whether a Run command's `dotnet` must go through the launcher, i.e. its project runs in the container. */
  needsLauncher: (input: { cwd: string; command: string }) => Promise<boolean>
  status: () => Promise<DotnetContainerStatus>
  /** Stops the container and every program in it. */
  stop: () => Promise<void>
  /** Removes the container and its images; the next run rebuilds them. */
  reset: () => Promise<void>
}
