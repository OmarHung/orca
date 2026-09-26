import { basename, join } from 'node:path'
import { spawnProcess } from '../../../shared/child-process/run-process'
import type { LaunchProfileDetails } from '../../../shared/run-configurations/dotnet-run-configurations'
import type { AdapterInstallDeps } from './adapter-installer'
import { downloadWithElectronNet } from './adapter-download'
import { extractArchive } from './archive-extract'
import { DebugPreparationError } from './prepared-debug-adapter'

const BUILD_TIMEOUT_MS = 10 * 60_000
// `  Project2 -> /abs/path/bin/Debug/net10.0/Project2.dll`
const BUILD_OUTPUT_PATTERN = /^\s*(\S+) -> (.+\.dll)\s*$/gm

export function createNetcoredbgInstallDeps(): AdapterInstallDeps {
  return { download: downloadWithElectronNet, extract: extractArchive }
}

export function netcoredbgExecutable(
  installDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  return join(installDir, 'netcoredbg', platform === 'win32' ? 'netcoredbg.exe' : 'netcoredbg')
}

/** The assembly `dotnet build` produced for the project, read from its `Name -> path` lines. */
export function findBuiltAssembly(buildOutput: string, projectName: string): string | null {
  const assemblies = [...buildOutput.matchAll(BUILD_OUTPUT_PATTERN)]
  const own = assemblies.find((match) => match[1] === projectName)
  return (own ?? assemblies.at(-1))?.[2]?.trim() ?? null
}

/** Splits launchSettings `commandLineArgs` the way a shell would for simple quoting. */
export function splitCommandLineArgs(value: string | null): string[] {
  if (!value) {
    return []
  }
  return [...value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? ''
  )
}

/** Builds the project in Debug, streaming output, and returns the assembly to launch. */
export function buildDotnetProject(options: {
  dotnet: string
  projectFile: string
  onOutput: (text: string) => void
}): Promise<string> {
  const child = spawnProcess({
    program: options.dotnet,
    args: ['build', options.projectFile, '-c', 'Debug', '-nologo'],
    stdio: ['ignore', 'pipe', 'pipe'],
    timeoutMs: BUILD_TIMEOUT_MS
  })
  let output = ''
  const collect = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    output += text
    options.onOutput(text)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new DebugPreparationError(`Build failed (exit ${code ?? 'signal'}); see the console`)
        )
        return
      }
      const projectName = basename(options.projectFile).replace(/\.[^.]+$/, '')
      const assembly = findBuiltAssembly(output, projectName)
      if (!assembly) {
        reject(new DebugPreparationError('The build did not report an assembly to debug'))
        return
      }
      resolve(assembly)
    })
  })
}

export function buildNetcoredbgLaunchArguments(options: {
  program: string
  cwd: string
  profile: LaunchProfileDetails | null
}): Record<string, unknown> {
  const { profile } = options
  const env: Record<string, string> = { ...profile?.environmentVariables }
  if (profile?.applicationUrl && !env.ASPNETCORE_URLS) {
    env.ASPNETCORE_URLS = profile.applicationUrl
  }
  return {
    type: 'coreclr',
    request: 'launch',
    name: 'Orca: .NET',
    program: options.program,
    args: splitCommandLineArgs(profile?.commandLineArgs ?? null),
    cwd: options.cwd,
    env,
    stopAtEntry: false,
    justMyCode: true
  }
}
