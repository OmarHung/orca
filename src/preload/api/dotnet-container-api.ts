export type DotnetContainerApi = {
  /** The `dotnet` launcher that sends pre-.NET 6 projects to Orca's container; null where unsupported. */
  launcherPath: () => Promise<string | null>
}
