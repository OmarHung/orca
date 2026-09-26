export type RunConfigurationKind = 'build' | 'run' | 'test' | 'publish' | 'other'

export type RunConfigurationEcosystem = 'node' | 'dotnet'

/** A run configuration derived from project files; suggested, never persisted. */
export type DetectedRunConfiguration = {
  /** Stable across detections of the same project, so runs can reuse their tab. */
  id: string
  ecosystem: RunConfigurationEcosystem
  projectName: string
  /** Absolute directory the command runs in. */
  projectDir: string
  kind: RunConfigurationKind
  /** Short name within the project, e.g. "dev" or "MvcWeb". */
  name: string
  command: string
}

const SHELL_SAFE = /^[A-Za-z0-9_.:@%+=,/\\-]+$/

/** Double quotes work the same in POSIX shells, cmd and PowerShell for plain arguments. */
export function quoteShellArgument(value: string): string {
  return SHELL_SAFE.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`
}
