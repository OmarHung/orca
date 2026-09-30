import { describe, expect, it } from 'vitest'
import { comparablePath, savedRunAnchor } from './saved-run-project-anchor'

describe('savedRunAnchor', () => {
  it('ties a .NET folder publish to its project file, relative or absolute', () => {
    const base = { type: 'dotnet-publish' as const, id: 'p', name: 'Publish' }
    expect(
      savedRunAnchor({ ...base, projectFile: 'projects/Project2/Project2.csproj' }, '/w')
    ).toEqual({
      ecosystem: 'dotnet',
      kind: 'publish',
      by: 'projectFile',
      path: 'projects/project2/project2.csproj'
    })
    expect(
      savedRunAnchor(
        { ...base, projectFile: '${workspaceFolder}/projects/Project2/Project2.csproj' },
        '/w'
      )?.path
    ).toBe('projects/project2/project2.csproj')
    expect(savedRunAnchor({ ...base, projectFile: '/elsewhere/X.csproj' }, '/w')).toBeNull()
  })

  it('ties debug configurations to a project file or folder', () => {
    const debug = { type: 'debug' as const, id: 'd', name: 'Debug' }
    expect(
      savedRunAnchor(
        { ...debug, target: { kind: 'dotnet-project', projectFile: '/w/src/Api/Api.csproj' } },
        '/w'
      )
    ).toMatchObject({
      ecosystem: 'dotnet',
      kind: 'run',
      by: 'projectFile',
      path: 'src/api/api.csproj'
    })
    expect(
      savedRunAnchor({ ...debug, target: { kind: 'python-file', filePath: 'api/main.py' } }, '/w')
    ).toMatchObject({ ecosystem: 'python', by: 'folder', path: 'api' })
    expect(
      savedRunAnchor(
        {
          ...debug,
          cwd: 'apps/web',
          target: { kind: 'node-script', packageManager: 'pnpm', script: 'dev' }
        },
        '/w'
      )
    ).toMatchObject({ ecosystem: 'node', by: 'folder', path: 'apps/web' })
    expect(
      savedRunAnchor({ ...debug, target: { kind: 'dotnet-program', program: 'a.dll' } }, '/w')
    ).toBeNull()
  })

  it('ignores commands and compounds, which name no project', () => {
    expect(
      savedRunAnchor({ type: 'command', id: 'c', name: 'C', command: 'make', cwd: 'api' }, '/w')
    ).toBeNull()
  })
})

describe('comparablePath', () => {
  it('folds separators and case', () => {
    expect(comparablePath('\\Src\\Api\\')).toBe('src/api')
  })
})
