import { describe, expect, it } from 'vitest'
import { routeDotnetCommand, startsWithDotnet } from './dotnet-command-route'

const LAUNCHER = '/Users/dev/Library/Application Support/orca/dotnet-container/dotnet'
const QUOTED = `'${LAUNCHER}'`

describe('routeDotnetCommand', () => {
  it('replaces only the leading dotnet with the quoted launcher', () => {
    expect(routeDotnetCommand('dotnet run --launch-profile "My App"', LAUNCHER)).toBe(
      `${QUOTED} run --launch-profile "My App"`
    )
    expect(routeDotnetCommand('  dotnet build', LAUNCHER)).toBe(`  ${QUOTED} build`)
    expect(routeDotnetCommand('dotnet', LAUNCHER)).toBe(QUOTED)
  })

  it('leaves other commands alone', () => {
    for (const command of ['npm run dev', 'dotnet-ef migrations add', 'cd api && dotnet run']) {
      expect(routeDotnetCommand(command, LAUNCHER)).toBe(command)
    }
  })

  it('invokes the quoted path the way PowerShell and Nushell need', () => {
    expect(routeDotnetCommand('dotnet run', LAUNCHER, '/opt/homebrew/bin/pwsh')).toBe(
      `& ${QUOTED} run`
    )
    expect(routeDotnetCommand('dotnet run', LAUNCHER, 'nu')).toBe(`^${QUOTED} run`)
    expect(routeDotnetCommand('dotnet run', LAUNCHER, '/bin/zsh')).toBe(`${QUOTED} run`)
  })

  it('does not quote a launcher path that needs none', () => {
    expect(routeDotnetCommand('dotnet test', '/opt/orca/dotnet')).toBe('/opt/orca/dotnet test')
  })
})

describe('startsWithDotnet', () => {
  it('matches a dotnet command and nothing that merely starts with the letters', () => {
    expect(startsWithDotnet('dotnet publish -c Release')).toBe(true)
    expect(startsWithDotnet('dotnet-ef database update')).toBe(false)
  })
})
