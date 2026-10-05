import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dotnetContainerPaths } from '../../../dotnet-container/dotnet-container-install'
import { applyDotnetContainerLauncherEnv, DOTNET_LAUNCHER_DIR_ENV } from './dotnet-container-env'

describe('applyDotnetContainerLauncherEnv', () => {
  let userDataPath: string
  let binDir: string

  beforeEach(() => {
    userDataPath = mkdtempSync(join(tmpdir(), 'orca-dotnet-env-'))
    const paths = dotnetContainerPaths(userDataPath)
    binDir = paths.binDir
    mkdirSync(binDir, { recursive: true })
    writeFileSync(paths.launcherPath, '#!/bin/sh\n')
  })

  afterEach(() => {
    rmSync(userDataPath, { recursive: true, force: true })
  })

  it('puts the launcher folder first on PATH exactly once and names it', () => {
    const env = { PATH: ['/usr/bin', binDir, '/bin'].join(delimiter) }
    applyDotnetContainerLauncherEnv(env, { dotnetContainerToolchain: true, userDataPath }, 'darwin')
    expect(env.PATH).toBe([binDir, '/usr/bin', '/bin'].join(delimiter))
    expect(env[DOTNET_LAUNCHER_DIR_ENV]).toBe(binDir)
  })

  it('drops an inherited launcher folder when the toolchain is off, on WSL or on Windows', () => {
    for (const [options, platform] of [
      [{ dotnetContainerToolchain: false, userDataPath }, 'darwin'],
      [{ dotnetContainerToolchain: true, userDataPath, isWsl: true }, 'linux'],
      [{ dotnetContainerToolchain: true, userDataPath }, 'win32']
    ] as const) {
      const env: Record<string, string> = { PATH: '/usr/bin', [DOTNET_LAUNCHER_DIR_ENV]: '/old' }
      applyDotnetContainerLauncherEnv(env, options, platform)
      expect(env).toEqual({ PATH: '/usr/bin' })
    }
  })

  it("drops another launch's launcher folder from PATH, with the toolchain on or off", () => {
    for (const dotnetContainerToolchain of [true, false]) {
      const env: Record<string, string> = {
        PATH: ['/other/bin', '/usr/bin', binDir].join(delimiter),
        [DOTNET_LAUNCHER_DIR_ENV]: '/other/bin'
      }
      applyDotnetContainerLauncherEnv(env, { dotnetContainerToolchain, userDataPath }, 'darwin')
      expect(env.PATH).toBe(
        dotnetContainerToolchain ? [binDir, '/usr/bin'].join(delimiter) : '/usr/bin'
      )
    }
  })

  it('leaves PATH alone until the launcher has been installed', () => {
    rmSync(dotnetContainerPaths(userDataPath).launcherPath)
    const env: Record<string, string> = { PATH: '/usr/bin' }
    applyDotnetContainerLauncherEnv(env, { dotnetContainerToolchain: true, userDataPath }, 'linux')
    expect(env).toEqual({ PATH: '/usr/bin' })
  })
})
