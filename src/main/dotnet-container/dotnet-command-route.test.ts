import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dotnetCommandArgs, dotnetCommandNeedsLauncher } from './dotnet-command-route'

describe('dotnetCommandArgs', () => {
  it('splits the words after dotnet like a POSIX shell, up to the first operator', () => {
    expect(
      dotnetCommandArgs(
        `dotnet run --project 'My App/App.csproj' --launch-profile "https" a\\ b && echo done`
      )
    ).toEqual(['run', '--project', 'My App/App.csproj', '--launch-profile', 'https', 'a b'])
    expect(dotnetCommandArgs('  dotnet build # comment\nsecond line')).toEqual(['build'])
    expect(dotnetCommandArgs('dotnet')).toEqual([])
  })

  it('gives up where a shell would still expand or continue the command', () => {
    for (const command of [
      'dotnet run --project $PROJECT',
      'dotnet run --project "$PROJECT"',
      'dotnet run --project ~/App/App.csproj',
      'dotnet build *.sln',
      'dotnet run --project "unterminated',
      'dotnet run \\',
      'npm run dev'
    ]) {
      expect(dotnetCommandArgs(command)).toBeNull()
    }
  })
})

describe('dotnetCommandNeedsLauncher', () => {
  let dir: string
  let launcher: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-dotnet-route-'))
    launcher = join(dir, 'dotnet')
    // Answers like the real launcher: container only for the legacy project.
    writeFileSync(
      launcher,
      '#!/bin/sh\n[ "$1" = --orca-where ] || exit 9\ncase "$*" in *Legacy.csproj*) echo container ;; *) echo native ;; esac\n'
    )
    chmodSync(launcher, 0o755)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps the plain command only when the launcher says the project runs natively', async () => {
    expect(await dotnetCommandNeedsLauncher(launcher, dir, 'dotnet run --project Api.csproj')).toBe(
      false
    )
    expect(
      await dotnetCommandNeedsLauncher(launcher, dir, 'dotnet run --project Legacy.csproj')
    ).toBe(true)
  })

  it('routes through the launcher whenever it cannot ask', async () => {
    expect(await dotnetCommandNeedsLauncher(launcher, dir, 'dotnet run --project $P')).toBe(true)
    expect(await dotnetCommandNeedsLauncher(launcher, 'relative', 'dotnet run')).toBe(true)
    expect(await dotnetCommandNeedsLauncher(join(dir, 'missing'), dir, 'dotnet run')).toBe(true)
  })
})
