import { describe, expect, it } from 'vitest'
import {
  findRunConfiguration,
  normalizeRunConfigurationDefinitions
} from './run-configuration-definition'

describe('normalizeRunConfigurationDefinitions', () => {
  it('infers the type from the fields and defaults the id to the name', () => {
    const { configurations, problems } = normalizeRunConfigurationDefinitions([
      { name: 'Build', command: 'dotnet build', cwd: 'src/Api' },
      {
        name: 'API',
        target: { kind: 'dotnet-project', projectFile: 'src/Api/Api.csproj' },
        args: ['--urls', 'http://localhost:5000'],
        env: { ASPNETCORE_ENVIRONMENT: 'Development', PORT: 5000 },
        beforeLaunch: ['Build']
      },
      { name: 'All', configurations: ['API', 'Build'] }
    ])
    expect(problems).toEqual([])
    expect(configurations).toEqual([
      {
        type: 'command',
        id: 'Build',
        name: 'Build',
        command: 'dotnet build',
        cwd: 'src/Api'
      },
      {
        type: 'debug',
        id: 'API',
        name: 'API',
        target: { kind: 'dotnet-project', projectFile: 'src/Api/Api.csproj' },
        args: ['--urls', 'http://localhost:5000'],
        env: { ASPNETCORE_ENVIRONMENT: 'Development', PORT: '5000' },
        beforeLaunch: ['Build']
      },
      {
        type: 'compound',
        id: 'All',
        name: 'All',
        configurations: ['API', 'Build']
      }
    ])
  })

  it('keeps an explicit type and id', () => {
    const { configurations } = normalizeRunConfigurationDefinitions([
      { type: 'command', id: 'b1', name: 'Build', command: 'make' }
    ])
    expect(configurations[0]).toMatchObject({ id: 'b1', type: 'command' })
  })

  it('reports and drops invalid entries', () => {
    const { configurations, problems } = normalizeRunConfigurationDefinitions([
      'nope',
      { name: 'No body' },
      { name: 'Bad target', target: { kind: 'rust-file', filePath: 'a.rs' } },
      {
        name: 'Bad script',
        target: { kind: 'node-script', packageManager: 'npm', script: 'a;rm' }
      },
      { name: 'Ok', command: 'ls' },
      { name: 'Ok', command: 'pwd' }
    ])
    expect(configurations.map((c) => c.name)).toEqual(['Ok'])
    expect(problems.map((p) => p.index)).toEqual([0, 1, 2, 3, 5])
  })

  it('accepts every debug target kind', () => {
    const { configurations, problems } = normalizeRunConfigurationDefinitions([
      {
        name: 'a',
        target: {
          kind: 'python-file',
          filePath: 'a.py',
          pythonPath: '.venv/bin/python'
        }
      },
      { name: 'b', target: { kind: 'python-module', module: 'app.main' } },
      {
        name: 'c',
        target: { kind: 'node-file', filePath: '${workspaceFolder}/index.js' }
      },
      {
        name: 'd',
        target: { kind: 'node-script', packageManager: 'pnpm', script: 'dev' }
      },
      {
        name: 'e',
        target: {
          kind: 'dotnet-project',
          projectFile: 'A.csproj',
          launchProfile: 'http'
        }
      },
      {
        name: 'f',
        target: { kind: 'dotnet-program', program: 'bin/Debug/net8.0/A.dll' }
      }
    ])
    expect(problems).toEqual([])
    expect(configurations).toHaveLength(6)
  })

  it('keeps sequential waits only for listed members and valid delays', () => {
    const { configurations } = normalizeRunConfigurationDefinitions([
      {
        name: 'All',
        configurations: ['a', 'b', 'c'],
        sequential: true,
        waitAfter: {
          a: { kind: 'exit' },
          b: { kind: 'delay', seconds: 0 },
          c: { kind: 'delay', seconds: 3 },
          gone: { kind: 'exit' }
        }
      },
      {
        name: 'Together',
        configurations: ['a'],
        waitAfter: { a: { kind: 'exit' } }
      }
    ])
    expect(configurations).toEqual([
      {
        type: 'compound',
        id: 'All',
        name: 'All',
        configurations: ['a', 'b', 'c'],
        sequential: true,
        waitAfter: { a: { kind: 'exit' }, c: { kind: 'delay', seconds: 3 } }
      },
      {
        type: 'compound',
        id: 'Together',
        name: 'Together',
        configurations: ['a']
      }
    ])
  })

  it('returns nothing for a non-list', () => {
    expect(normalizeRunConfigurationDefinitions({ name: 'x' }).configurations).toEqual([])
  })
})

describe('findRunConfiguration', () => {
  const { configurations } = normalizeRunConfigurationDefinitions([
    { id: 'x1', name: 'Build', command: 'make' },
    { name: 'Test', command: 'make test' }
  ])
  it('matches by id first, then by name', () => {
    expect(findRunConfiguration(configurations, 'x1')?.name).toBe('Build')
    expect(findRunConfiguration(configurations, 'Build')?.id).toBe('x1')
    expect(findRunConfiguration(configurations, 'missing')).toBeNull()
  })
})
