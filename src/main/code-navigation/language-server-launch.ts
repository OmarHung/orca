import { join } from 'node:path'
import {
  ensureDebugAdapterInstalled,
  isDebugAdapterInstalled,
  type AdapterInstallDeps
} from '../debug/adapters/adapter-installer'
import type { DebugAdapterArtifact } from '../debug/adapters/adapter-manifest'
import { downloadWithElectronNet } from '../debug/adapters/adapter-download'
import { extractArchive } from '../debug/adapters/archive-extract'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import type { CodeNavigationServerKind } from '../../shared/code-navigation/code-navigation-types'
import type { LanguageServerLaunch } from './language-server-session'
import { findCsharpSolution } from './csharp-solution-discovery'
import {
  CSHARP_SERVER_ARTIFACT,
  CSHARP_SERVER_ENTRY,
  typescriptServerArtifactFor
} from './language-server-manifest'

export type LanguageServerLaunchDeps = {
  install: AdapterInstallDeps
  resolveCommand: (command: string) => Promise<string | null>
  platform: NodeJS.Platform
  arch: string
  env: NodeJS.ProcessEnv
  findSolution: (root: string) => Promise<string | null>
}

const defaultDeps = (): LanguageServerLaunchDeps => ({
  install: { download: downloadWithElectronNet, extract: extractArchive },
  resolveCommand: (command) => resolveCommandOnLocalPath(command),
  platform: process.platform,
  arch: process.arch,
  env: process.env,
  findSolution: (root) => findCsharpSolution(root)
})

export function languageServersDir(userDataDir: string): string {
  return join(userDataDir, 'language-servers')
}

async function installServer(
  artifact: DebugAdapterArtifact,
  baseDir: string,
  deps: LanguageServerLaunchDeps,
  onDownloading: () => void
): Promise<string> {
  if (!(await isDebugAdapterInstalled(artifact, baseDir))) {
    onDownloading()
  }
  return ensureDebugAdapterInstalled(artifact, baseDir, deps.install)
}

function artifactFor(
  kind: CodeNavigationServerKind,
  deps: Pick<LanguageServerLaunchDeps, 'platform' | 'arch'>
): DebugAdapterArtifact | null {
  return kind === 'typescript'
    ? typescriptServerArtifactFor(deps.platform, deps.arch)
    : CSHARP_SERVER_ARTIFACT
}

/** Whether `prepareLanguageServerLaunch` would start this kind without downloading anything. */
export async function isLanguageServerInstalled(
  kind: CodeNavigationServerKind,
  baseDir: string,
  deps: Pick<LanguageServerLaunchDeps, 'platform' | 'arch'> = defaultDeps()
): Promise<boolean> {
  const artifact = artifactFor(kind, deps)
  return artifact ? isDebugAdapterInstalled(artifact, baseDir) : false
}

/** Downloads the server on first use and returns how to start it. */
export async function prepareLanguageServerLaunch(
  kind: CodeNavigationServerKind,
  root: string,
  baseDir: string,
  onDownloading: () => void,
  deps: LanguageServerLaunchDeps = defaultDeps()
): Promise<LanguageServerLaunch> {
  if (kind === 'typescript') {
    const artifact = artifactFor('typescript', deps)
    if (!artifact) {
      throw new Error(`TypeScript navigation is not available for ${deps.platform}-${deps.arch}`)
    }
    const installDir = await installServer(artifact, baseDir, deps, onDownloading)
    const binary = deps.platform === 'win32' ? 'tsc.exe' : 'tsc'
    return {
      program: join(installDir, 'package', 'lib', binary),
      args: ['--lsp', '--stdio'],
      env: deps.env
    }
  }

  // Why resolved first: without dotnet there is no point downloading the server.
  const dotnet = await deps.resolveCommand('dotnet')
  if (!dotnet) {
    throw new Error('C# navigation needs the .NET SDK, but dotnet was not found on PATH')
  }
  const installDir = await installServer(CSHARP_SERVER_ARTIFACT, baseDir, deps, onDownloading)
  const solution = await deps.findSolution(root).catch(() => null)
  return {
    program: dotnet,
    // Why a relative path: csharp-ls resolves --solution against its working directory, the root.
    args: [
      join(installDir, ...CSHARP_SERVER_ENTRY),
      // Why: without it, the C# in Razor views (.cshtml) gets no navigation at all.
      '--features',
      'razor-support',
      ...(solution ? ['--solution', solution] : [])
    ],
    env: {
      ...deps.env,
      // Why Major: the server targets .NET 10 and should also run on a newer runtime.
      DOTNET_ROLL_FORWARD: 'Major',
      // Why: views of pre-.NET 6 projects get no generated C# (so no Model navigation) without it.
      UseRazorSourceGenerator: 'true'
    },
    // Why: without metadata URIs, jumping to a framework type (Console, List<T>) finds nothing.
    configuration: { csharp: { useMetadataUris: true } }
  }
}
