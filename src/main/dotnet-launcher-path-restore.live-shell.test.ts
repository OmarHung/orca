/**
 * Real-zsh proof that the .NET container launcher is still first on PATH at the
 * first prompt, after macOS path_helper and a user .zshrc that prepends ~/.dotnet.
 */
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getShellLaunchConfig } from './providers/local-pty-shell-ready'
import { selectShellStartupFeatures } from './shell-startup-features'
import { hasZsh, makeZshHome, runZshPty, ZSH_PATH } from './zsh-startup-hook-pty-harness'

const itWithZsh = hasZsh ? it : it.skip

describe.skipIf(process.platform === 'win32')('.NET container launcher on PATH', () => {
  itWithZsh('stays ahead of a ~/.dotnet that the user’s .zshrc prepends', async () => {
    const home = makeZshHome({ '.zshrc': 'export PATH="$HOME/.dotnet:$PATH"\n' })
    try {
      const launcherDir = join(home, 'orca-user-data', 'dotnet-container', 'bin')
      mkdirSync(launcherDir, { recursive: true })
      const env: Record<string, string> = {
        HOME: home,
        PATH: `${launcherDir}:/usr/bin:/bin`,
        ORCA_DOTNET_LAUNCHER_DIR: launcherDir
      }
      const features = selectShellStartupFeatures({
        shellPath: ZSH_PATH,
        env,
        hasStartupCommand: false,
        waitsForShellReady: false,
        emitsStartupIdentity: false
      })
      const launch = getShellLaunchConfig(ZSH_PATH, features)

      const { values } = await runZshPty({
        env: { ...env, ...launch.env, ORCA_ORIG_ZDOTDIR: home },
        report: ['PATH']
      })

      expect(features).toContain('overlay')
      const entries = values.PATH?.split(':') ?? []
      expect(entries[0]).toBe(launcherDir)
      expect(entries).toContain(join(home, '.dotnet'))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
