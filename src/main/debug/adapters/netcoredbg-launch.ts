import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  readLaunchProfileDetails,
  type LaunchProfileDetails
} from '../../../shared/run-configurations/dotnet-run-configurations'
import { resolveCommandOnLocalPath } from '../../ipc/command-path-resolver'
import { isExecutableFile } from '../../python/python-interpreters'
import { startStdioDapTransport } from '../dap-transport-stdio'
import { ensureDebugAdapterInstalled } from './adapter-installer'
import { netcoredbgArtifactFor } from './adapter-manifest'
import { readExecutableArch } from './executable-arch'
import {
  buildDotnetProject,
  buildNetcoredbgLaunchArguments,
  createNetcoredbgInstallDeps,
  netcoredbgExecutable
} from './netcoredbg-adapter'
import {
  DebugPreparationError,
  type AdapterPreparation,
  type PreparedDebugAdapter
} from './prepared-debug-adapter'

const MAX_STDERR_CHARS = 4_000

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

export type NetcoredbgTarget = { projectFile: string; launchProfile?: string } | { program: string }

/** A project is built first and runs from its folder; a prebuilt program runs as given. */
async function resolveNetcoredbgProgram(
  context: AdapterPreparation,
  dotnet: string,
  target: NetcoredbgTarget
): Promise<{ program: string; cwd: string; profile: LaunchProfileDetails | null }> {
  if ('program' in target) {
    return { program: target.program, cwd: context.cwd, profile: null }
  }
  const projectDir = dirname(target.projectFile)
  context.onOutput(`dotnet build ${target.projectFile} -c Debug\n`, 'console')
  const program = await buildDotnetProject({
    dotnet,
    projectFile: target.projectFile,
    onOutput: (text) => context.onOutput(text, 'stdout')
  })
  const profile = target.launchProfile
    ? readLaunchProfileDetails(
        await readOptionalText(join(projectDir, 'Properties', 'launchSettings.json')),
        target.launchProfile
      )
    : null
  return { program, cwd: projectDir, profile }
}

export async function prepareNetcoredbg(
  context: AdapterPreparation,
  target: NetcoredbgTarget
): Promise<PreparedDebugAdapter> {
  const dotnet = await resolveCommandOnLocalPath('dotnet')
  if (!dotnet) {
    throw new DebugPreparationError('The dotnet SDK was not found on PATH')
  }
  // Why dotnet's arch, not Orca's: the debugger must match the process it attaches to, and an
  // Intel dotnet on Apple Silicon runs every program as x64 under Rosetta.
  const dotnetArch = (await readExecutableArch(dotnet).catch(() => null)) ?? process.arch
  const artifact = netcoredbgArtifactFor(process.platform, dotnetArch)
  if (!artifact) {
    throw new DebugPreparationError(
      `.NET debugging is not available for ${process.platform}-${dotnetArch} (netcoredbg has no build for it)`
    )
  }
  if (dotnetArch !== process.arch) {
    context.onOutput(
      `${dotnet} is an ${dotnetArch} build, so the ${dotnetArch} debugger is used.\n`,
      'console'
    )
  }
  context.onInstalling()
  const installDir = await ensureDebugAdapterInstalled(
    artifact,
    context.adaptersDir,
    createNetcoredbgInstallDeps()
  )
  const executable = netcoredbgExecutable(installDir)
  if (!(await isExecutableFile(executable))) {
    throw new DebugPreparationError(`netcoredbg is missing from ${installDir}`)
  }

  const { program, cwd, profile } = await resolveNetcoredbgProgram(context, dotnet, target)

  let stderr = ''
  return {
    adapterId: 'coreclr',
    transport: startStdioDapTransport({
      program: executable,
      args: ['--interpreter=vscode'],
      cwd,
      env: process.env,
      onStderr: (text) => {
        stderr = (stderr + text).slice(-MAX_STDERR_CHARS)
      }
    }),
    launchArguments: buildNetcoredbgLaunchArguments({ program, cwd, profile }),
    diagnostics: () => stderr.trim(),
    dispose: () => {}
  }
}
