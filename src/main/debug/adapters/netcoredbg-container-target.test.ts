import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ensureDotnetContainer,
  isLegacyRuntimeConfig,
  runsInDotnetContainer
} from './netcoredbg-container-target'
import { DebugPreparationError } from './prepared-debug-adapter'

describe('isLegacyRuntimeConfig', () => {
  it('flags pre-.NET 6 frameworks by tfm, or by framework version when tfm is missing', () => {
    const config = (body: string): string => `{ "runtimeOptions": { ${body} } }`
    expect(isLegacyRuntimeConfig(config('"tfm": "netcoreapp3.1"'))).toBe(true)
    expect(isLegacyRuntimeConfig(config('"tfm": "net5.0"'))).toBe(true)
    expect(isLegacyRuntimeConfig(config('"tfm": "net8.0"'))).toBe(false)
    expect(
      isLegacyRuntimeConfig(
        config('"framework": { "name": "Microsoft.NETCore.App", "version": "2.2.0" }')
      )
    ).toBe(true)
    expect(isLegacyRuntimeConfig(null)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('container debug launcher calls', () => {
  let dir: string

  function launcher(script: string): string {
    const path = join(dir, 'dotnet')
    writeFileSync(path, `#!/bin/sh\n${script}\n`)
    chmodSync(path, 0o755)
    return path
  }

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'orca-netcoredbg-container-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("asks the launcher where a project runs, and reads a program's runtimeconfig", async () => {
    const where = launcher('[ "$1" = --orca-where ] && echo container')
    const projectFile = join(dir, 'App.csproj')
    writeFileSync(projectFile, '<Project />')
    expect(await runsInDotnetContainer(where, { projectFile })).toBe(true)
    const native = launcher('echo native')
    expect(await runsInDotnetContainer(native, { projectFile })).toBe(false)

    const program = join(dir, 'App.dll')
    writeFileSync(join(dir, 'App.runtimeconfig.json'), '{"runtimeOptions":{"tfm":"netcoreapp2.2"}}')
    expect(await runsInDotnetContainer(native, { program })).toBe(true)
    expect(await runsInDotnetContainer(native, { program: join(dir, 'App') })).toBe(true)
    expect(await runsInDotnetContainer(native, { program: join(dir, 'Other.dll') })).toBe(false)
  })

  it("streams the container's preparation and reports why it failed", async () => {
    const output: string[] = []
    await ensureDotnetContainer(launcher('echo "building image" >&2'), dir, (text) =>
      output.push(text)
    )
    expect(output.join('')).toContain('building image')

    const failing = launcher('echo "orca: Docker is not running." >&2; exit 1')
    await expect(ensureDotnetContainer(failing, dir, () => {})).rejects.toThrow(
      new DebugPreparationError(
        'Could not prepare the .NET container: orca: Docker is not running.'
      )
    )
    await expect(ensureDotnetContainer(launcher('exit 3'), dir, () => {})).rejects.toThrow(
      'Could not prepare the .NET container: exit 3'
    )
  })
})
