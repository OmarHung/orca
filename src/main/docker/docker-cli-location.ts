import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'

/** Where Docker Desktop, OrbStack, Colima and Homebrew put the CLI when PATH does not have it. */
function wellKnownDockerPaths(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    return [path.win32.join(programFiles, 'Docker', 'Docker', 'resources', 'bin', 'docker.exe')]
  }
  if (platform === 'darwin') {
    return [
      '/usr/local/bin/docker',
      '/opt/homebrew/bin/docker',
      path.join(os.homedir(), '.orbstack', 'bin', 'docker'),
      '/Applications/Docker.app/Contents/Resources/bin/docker'
    ]
  }
  return ['/usr/bin/docker', '/usr/local/bin/docker']
}

export async function resolveDockerPath(): Promise<string | null> {
  const onPath = await resolveCommandOnLocalPath(
    process.platform === 'win32' ? 'docker.exe' : 'docker'
  )
  return (
    onPath ??
    wellKnownDockerPaths(process.platform).find((candidate) => existsSync(candidate)) ??
    null
  )
}
