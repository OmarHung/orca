import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import {
  isLanguageServerInstalled,
  prepareLanguageServerLaunch,
  type LanguageServerLaunchDeps
} from './language-server-launch'
import { CSHARP_SERVER_ARTIFACT, typescriptServerArtifactFor } from './language-server-manifest'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'orca-language-servers-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

function deps(overrides: Partial<LanguageServerLaunchDeps> = {}): LanguageServerLaunchDeps {
  return {
    install: {
      download: vi.fn(async () => {
        throw new Error('no network in tests')
      }),
      extract: vi.fn()
    },
    resolveCommand: vi.fn(async () => '/usr/local/share/dotnet/dotnet'),
    platform: 'darwin',
    arch: 'arm64',
    env: { PATH: '/usr/bin' },
    ...overrides
  }
}

async function markInstalled(name: string, version: string): Promise<string> {
  const installDir = join(baseDir, name, version)
  await mkdir(installDir, { recursive: true })
  await writeFile(join(installDir, '.orca-installed'), 'test')
  return installDir
}

describe('prepareLanguageServerLaunch', () => {
  it('runs the native TypeScript server over stdio from its install directory', async () => {
    const artifact = typescriptServerArtifactFor('darwin', 'arm64')!
    const installDir = await markInstalled(artifact.name, artifact.version)
    const onDownloading = vi.fn()

    const launch = await prepareLanguageServerLaunch('typescript', baseDir, onDownloading, deps())

    expect(launch).toEqual({
      program: join(installDir, 'package', 'lib', 'tsc'),
      args: ['--lsp', '--stdio'],
      env: { PATH: '/usr/bin' }
    })
    expect(onDownloading).not.toHaveBeenCalled()
  })

  it('uses tsc.exe on Windows', async () => {
    const artifact = typescriptServerArtifactFor('win32', 'x64')!
    const installDir = await markInstalled(artifact.name, artifact.version)

    const launch = await prepareLanguageServerLaunch(
      'typescript',
      baseDir,
      () => {},
      deps({ platform: 'win32', arch: 'x64' })
    )

    expect(launch.program).toBe(join(installDir, 'package', 'lib', 'tsc.exe'))
  })

  it('reports a download when the server is missing', async () => {
    const onDownloading = vi.fn()

    await expect(
      prepareLanguageServerLaunch('typescript', baseDir, onDownloading, deps())
    ).rejects.toThrow('no network in tests')
    expect(onDownloading).toHaveBeenCalledTimes(1)
  })

  it('refuses platforms without a TypeScript build', async () => {
    await expect(
      prepareLanguageServerLaunch('typescript', baseDir, () => {}, deps({ platform: 'aix' }))
    ).rejects.toThrow('not available for aix-arm64')
  })

  it('runs csharp-ls with the dotnet on PATH, allowing newer runtimes', async () => {
    const installDir = await markInstalled(
      CSHARP_SERVER_ARTIFACT.name,
      CSHARP_SERVER_ARTIFACT.version
    )

    const launch = await prepareLanguageServerLaunch('csharp', baseDir, () => {}, deps())

    expect(launch).toEqual({
      program: '/usr/local/share/dotnet/dotnet',
      args: [join(installDir, 'tools', 'net10.0', 'any', 'CSharpLanguageServer.dll')],
      env: { PATH: '/usr/bin', DOTNET_ROLL_FORWARD: 'Major' },
      configuration: { csharp: { useMetadataUris: true } }
    })
  })

  it('does not download the C# server when dotnet is missing', async () => {
    const onDownloading = vi.fn()
    const launchDeps = deps({ resolveCommand: vi.fn(async () => null) })

    await expect(
      prepareLanguageServerLaunch('csharp', baseDir, onDownloading, launchDeps)
    ).rejects.toThrow('dotnet was not found on PATH')
    expect(onDownloading).not.toHaveBeenCalled()
    expect(launchDeps.install.download).not.toHaveBeenCalled()
  })

  it('reports whether a kind is installed for this platform', async () => {
    const artifact = typescriptServerArtifactFor('darwin', 'arm64')!
    const platform = { platform: 'darwin' as const, arch: 'arm64' }

    expect(await isLanguageServerInstalled('typescript', baseDir, platform)).toBe(false)
    await markInstalled(artifact.name, artifact.version)
    expect(await isLanguageServerInstalled('typescript', baseDir, platform)).toBe(true)
    expect(await isLanguageServerInstalled('csharp', baseDir, platform)).toBe(false)
    expect(
      await isLanguageServerInstalled('typescript', baseDir, { platform: 'aix', arch: 'x' })
    ).toBe(false)
  })
})
