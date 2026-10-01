import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import {
  isLanguageServerInstalled,
  prepareLanguageServerLaunch,
  type LanguageServerLaunchDeps
} from './language-server-launch'
import { VUE_LANGUAGE_SERVER_PACKAGES } from './vue-language-server-manifest'

const ORCA = '/Applications/Orca.app/Contents/MacOS/Orca'

let baseDir: string

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'orca-vue-server-'))
})

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true })
})

function deps(): LanguageServerLaunchDeps {
  return {
    install: {
      download: vi.fn(async () => {
        throw new Error('no network in tests')
      }),
      extract: vi.fn()
    },
    resolveCommand: vi.fn(async () => null),
    platform: 'darwin',
    arch: 'arm64',
    env: { PATH: '/usr/bin' },
    execPath: ORCA,
    findSolution: vi.fn(async () => null)
  }
}

async function markInstalled(): Promise<string> {
  const { name, version } = VUE_LANGUAGE_SERVER_PACKAGES
  const installDir = join(baseDir, name, version)
  await mkdir(installDir, { recursive: true })
  await writeFile(join(installDir, '.orca-installed'), version)
  return installDir
}

describe('prepareLanguageServerLaunch for Vue', () => {
  it("runs vtsls on Orca's own runtime with the Vue plugin and no syntax server", async () => {
    const installDir = await markInstalled()
    const launchDeps = deps()

    const launch = await prepareLanguageServerLaunch(
      'vue',
      '/workspace/shop',
      baseDir,
      () => {},
      launchDeps
    )

    expect(launch.program).toBe(ORCA)
    expect(launch.args).toEqual([
      join(installDir, 'node_modules', '@vtsls', 'language-server', 'bin', 'vtsls.js'),
      '--stdio'
    ])
    expect(launch.env).toEqual({ PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1' })
    expect(launch.configuration).toEqual({
      vtsls: {
        autoUseWorkspaceTsdk: true,
        tsserver: {
          globalPlugins: [
            {
              name: '@vue/typescript-plugin',
              location: installDir,
              languages: ['vue'],
              configNamespace: 'typescript',
              enableForWorkspaceTypeScriptVersions: true
            }
          ]
        }
      },
      typescript: { tsserver: { useSyntaxServer: 'never' } }
    })
    // Why: Vue needs no SDK on PATH, unlike C#.
    expect(launchDeps.resolveCommand).not.toHaveBeenCalled()
  })

  it('downloads the package set on first use', async () => {
    const onDownloading = vi.fn()
    const launchDeps = deps()

    await expect(
      prepareLanguageServerLaunch('vue', '/workspace/shop', baseDir, onDownloading, launchDeps)
    ).rejects.toThrow('no network in tests')

    expect(onDownloading).toHaveBeenCalledTimes(1)
    expect(launchDeps.install.download).toHaveBeenCalled()
  })

  it('reports whether the package set is installed', async () => {
    expect(await isLanguageServerInstalled('vue', baseDir)).toBe(false)
    await markInstalled()
    expect(await isLanguageServerInstalled('vue', baseDir)).toBe(true)
  })
})
