import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }))

import {
  buildNetcoredbgLaunchArguments,
  findBuiltAssembly,
  splitCommandLineArgs
} from './netcoredbg-adapter'

const BUILD_OUTPUT = `  Determining projects to restore...
  Shared -> /w/Shared/bin/Debug/net10.0/Shared.dll
  Project2 -> /w/Project2/bin/Debug/net10.0/Project2.dll

Build succeeded.`

describe('findBuiltAssembly', () => {
  it("picks the project's own assembly over referenced projects", () => {
    expect(findBuiltAssembly(BUILD_OUTPUT, 'Project2')).toBe(
      '/w/Project2/bin/Debug/net10.0/Project2.dll'
    )
  })

  it('falls back to the last assembly, and to null when there is none', () => {
    expect(findBuiltAssembly(BUILD_OUTPUT, 'Renamed')).toBe(
      '/w/Project2/bin/Debug/net10.0/Project2.dll'
    )
    expect(findBuiltAssembly('Build FAILED.', 'Project2')).toBeNull()
  })
})

describe('splitCommandLineArgs', () => {
  it('splits on spaces and keeps quoted arguments together', () => {
    expect(splitCommandLineArgs('--seed demo --name "My App"')).toEqual([
      '--seed',
      'demo',
      '--name',
      'My App'
    ])
    expect(splitCommandLineArgs(null)).toEqual([])
  })
})

describe('buildNetcoredbgLaunchArguments', () => {
  it('applies the launch profile environment, URLs and arguments', () => {
    expect(
      buildNetcoredbgLaunchArguments({
        program: '/w/Project2/bin/Debug/net10.0/Project2.dll',
        cwd: '/w/Project2',
        profile: {
          environmentVariables: { ASPNETCORE_ENVIRONMENT: 'Development' },
          applicationUrl: 'http://localhost:5000',
          commandLineArgs: '--seed demo'
        }
      })
    ).toMatchObject({
      type: 'coreclr',
      request: 'launch',
      program: '/w/Project2/bin/Debug/net10.0/Project2.dll',
      cwd: '/w/Project2',
      args: ['--seed', 'demo'],
      env: { ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: 'http://localhost:5000' }
    })
  })

  it('keeps an explicit ASPNETCORE_URLS from the profile environment', () => {
    const args = buildNetcoredbgLaunchArguments({
      program: '/p/App.dll',
      cwd: '/p',
      profile: {
        environmentVariables: { ASPNETCORE_URLS: 'http://+:8080' },
        applicationUrl: 'http://localhost:5000',
        commandLineArgs: null
      }
    })

    expect(args.env).toEqual({ ASPNETCORE_URLS: 'http://+:8080' })
  })
})
