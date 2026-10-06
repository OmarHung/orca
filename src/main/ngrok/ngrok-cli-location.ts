import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'

/** Where Homebrew, winget, Chocolatey and snap put ngrok when PATH does not have it. */
function wellKnownNgrokPaths(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    return [
      ...(localAppData
        ? [
            path.win32.join(localAppData, 'Microsoft', 'WinGet', 'Links', 'ngrok.exe'),
            path.win32.join(localAppData, 'Microsoft', 'WindowsApps', 'ngrok.exe')
          ]
        : []),
      path.win32.join(
        process.env.ProgramData ?? 'C:\\ProgramData',
        'chocolatey',
        'bin',
        'ngrok.exe'
      )
    ]
  }
  if (platform === 'darwin') {
    return ['/opt/homebrew/bin/ngrok', '/usr/local/bin/ngrok']
  }
  return ['/usr/local/bin/ngrok', '/usr/bin/ngrok', '/snap/bin/ngrok']
}

export async function resolveNgrokPath(): Promise<string | null> {
  // Why: an install outside PATH and the well-known places, and E2E's fake agent, name it directly.
  const override = process.env.ORCA_NGROK_PATH
  if (override && existsSync(override)) {
    return override
  }
  const onPath = await resolveCommandOnLocalPath(
    process.platform === 'win32' ? 'ngrok.exe' : 'ngrok'
  )
  return (
    onPath ??
    wellKnownNgrokPaths(process.platform).find((candidate) => existsSync(candidate)) ??
    null
  )
}
