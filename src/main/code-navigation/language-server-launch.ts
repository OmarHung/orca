import { join } from 'node:path'
import {
  LANGUAGE_SERVERS_DIR_NAME,
  type CodeNavigationServerKind
} from '../../shared/code-navigation/code-navigation-types'
import {
  ensureDebugAdapterInstalled,
  isDebugAdapterInstalled,
  type AdapterInstallDeps
} from '../debug/adapters/adapter-installer'
import type { DebugAdapterArtifact } from '../debug/adapters/adapter-manifest'
import { downloadWithElectronNet } from '../debug/adapters/adapter-download'
import { extractArchive } from '../debug/adapters/archive-extract'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import type { LanguageServerLaunch } from './language-server-session'
import { findCsharpSolution } from './csharp-solution-discovery'
import { ensureCsharpRazorDesignTimeTargets } from './csharp-razor-design-time'
import { ensureNpmPackageSetInstalled, isNpmPackageSetInstalled } from './npm-package-set-installer'
import { VUE_LANGUAGE_SERVER_PACKAGES } from './vue-language-server-manifest'
import { vueServerLaunch } from './vue-language-server-launch'
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
  /** Orca's own binary, which runs JavaScript servers as Node (ELECTRON_RUN_AS_NODE). */
  execPath: string
  findSolution: (root: string) => Promise<string | null>
}

const defaultDeps = (): LanguageServerLaunchDeps => ({
  install: { download: downloadWithElectronNet, extract: extractArchive },
  resolveCommand: (command) => resolveCommandOnLocalPath(command),
  platform: process.platform,
  arch: process.arch,
  env: process.env,
  execPath: process.execPath,
  findSolution: (root) => findCsharpSolution(root)
})

export function languageServersDir(userDataDir: string): string {
  return join(userDataDir, LANGUAGE_SERVERS_DIR_NAME)
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
  kind: Exclude<CodeNavigationServerKind, 'vue'>,
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
  if (kind === 'vue') {
    return isNpmPackageSetInstalled(VUE_LANGUAGE_SERVER_PACKAGES, baseDir)
  }
  const artifact = artifactFor(kind, deps)
  return artifact ? isDebugAdapterInstalled(artifact, baseDir) : false
}

/** MSBuild env that lets csharp-ls see the C# of views in pre-.NET 6 projects. */
async function legacyRazorEnv(baseDir: string, env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  // Why: pre-3.0 projects only run the Razor generator when this is set.
  const legacy: NodeJS.ProcessEnv = { UseRazorSourceGenerator: 'true' }
  // Why: never replace a hook the user's own environment already installs.
  if (env.CustomAfterMicrosoftCommonTargets) {
    return legacy
  }
  try {
    const targets = await ensureCsharpRazorDesignTimeTargets(baseDir)
    return { ...legacy, CustomAfterMicrosoftCommonTargets: targets }
  } catch (error) {
    console.warn('[code-navigation] Razor design-time targets unavailable:', error)
    return legacy
  }
}

/** Downloads the server on first use and returns how to start it. */
export async function prepareLanguageServerLaunch(
  kind: CodeNavigationServerKind,
  root: string,
  baseDir: string,
  onDownloading: () => void,
  deps: LanguageServerLaunchDeps = defaultDeps()
): Promise<LanguageServerLaunch> {
  if (kind === 'vue') {
    if (!(await isNpmPackageSetInstalled(VUE_LANGUAGE_SERVER_PACKAGES, baseDir))) {
      onDownloading()
    }
    const installDir = await ensureNpmPackageSetInstalled(
      VUE_LANGUAGE_SERVER_PACKAGES,
      baseDir,
      deps.install
    )
    return vueServerLaunch(installDir, deps)
  }
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
  const razorEnv = await legacyRazorEnv(baseDir, deps.env)
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
      ...razorEnv
    },
    // Why: without metadata URIs, jumping to a framework type (Console, List<T>) finds nothing.
    configuration: { csharp: { useMetadataUris: true } }
  }
}
