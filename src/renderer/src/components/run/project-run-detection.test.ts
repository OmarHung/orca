import { describe, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      worktreesByRepo: { repo: [{ id: 'wt', path: '/w', repoId: 'repo' }] }
    })
  }
}))

import {
  detectProjectRunConfigurations,
  detectWorkspaceRunConfigurations,
  mayContainRunConfigurations
} from './project-run-detection'

const TREE: Record<string, string[]> = {
  '/w/app': ['package.json', 'pnpm-lock.yaml', 'App.csproj', 'Properties', 'README.md'],
  '/w/app/Properties': ['launchSettings.json', 'PublishProfiles'],
  '/w/app/Properties/PublishProfiles': ['Folder.pubxml', 'notes.txt']
}
const FILES: Record<string, string> = {
  '/w/app/package.json': JSON.stringify({
    name: 'app',
    private: true,
    scripts: { dev: 'vite' }
  }),
  '/w/app/App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web" />',
  '/w/app/Properties/launchSettings.json': '{"profiles":{"App":{"commandName":"Project"}}}'
}
const listDirectories = async (dir: string): Promise<string[]> =>
  (TREE[dir] ?? []).filter((name) => TREE[`${dir}/${name}`] !== undefined)
const files = {
  listNames: async (dir: string) => TREE[dir] ?? [],
  listDirectories,
  readText: async (path: string) => FILES[path] ?? null
}

const WORKSPACE_TREE: Record<string, string[]> = {
  '/w': ['package.json', 'web', 'node_modules', '.git', 'src', 'venv'],
  '/w/venv': ['main.py'],
  '/w/web': ['package.json'],
  '/w/node_modules': ['package.json'],
  '/w/.git': ['package.json'],
  '/w/src': ['Api'],
  '/w/src/Api': ['Api.csproj', 'a'],
  '/w/src/Api/a': ['b'],
  '/w/src/Api/a/b': ['c'],
  '/w/src/Api/a/b/c': ['package.json']
}
const WORKSPACE_FILES: Record<string, string> = {
  '/w/package.json': JSON.stringify({ private: true, scripts: { lint: 'x' } }),
  '/w/web/package.json': JSON.stringify({
    private: true,
    scripts: { dev: 'vite' }
  }),
  '/w/node_modules/package.json': JSON.stringify({
    private: true,
    scripts: { no: 'x' }
  }),
  '/w/.git/package.json': JSON.stringify({
    private: true,
    scripts: { no: 'x' }
  }),
  '/w/src/Api/Api.csproj': '<Project Sdk="Microsoft.NET.Sdk" />',
  '/w/src/Api/a/b/c/package.json': JSON.stringify({
    private: true,
    scripts: { no: 'x' }
  })
}
const workspaceFiles = {
  listNames: async (dir: string) => WORKSPACE_TREE[dir] ?? [],
  listDirectories: async (dir: string) =>
    (WORKSPACE_TREE[dir] ?? []).filter((name) => WORKSPACE_TREE[`${dir}/${name}`] !== undefined),
  readText: async (path: string) => WORKSPACE_FILES[path] ?? null
}

describe('detectWorkspaceRunConfigurations', () => {
  it('scans the root and four folder levels, skipping dependency and hidden folders', async () => {
    const configurations = await detectWorkspaceRunConfigurations('wt', workspaceFiles)

    expect(configurations.map((configuration) => configuration.command)).toEqual([
      'npm run lint',
      'npm run dev',
      'dotnet build Api.csproj'
    ])
  })
})

describe('detectProjectRunConfigurations', () => {
  it('collects every project a folder directly contains', async () => {
    const configurations = await detectProjectRunConfigurations('wt', '/w/app', true, files)

    expect(configurations.map((configuration) => configuration.command)).toEqual([
      'pnpm run dev',
      'dotnet build App.csproj',
      'dotnet run --project App.csproj --launch-profile App',
      'dotnet publish App.csproj -p:PublishProfile=Folder'
    ])
    expect(new Set(configurations.map((configuration) => configuration.projectDir))).toEqual(
      new Set(['/w/app'])
    )
  })

  it('limits a project file to its own project', async () => {
    const configurations = await detectProjectRunConfigurations(
      'wt',
      '/w/app/App.csproj',
      false,
      files
    )

    expect(configurations.every((configuration) => configuration.ecosystem === 'dotnet')).toBe(true)
  })

  it('reads a Python project through its virtualenv, which needs pyvenv.cfg', async () => {
    const tree: Record<string, string[]> = {
      '/w/py': ['pyproject.toml', 'main.py', 'env', '.venv'],
      '/w/py/env': ['settings.toml', 'bin'],
      '/w/py/.venv': ['pyvenv.cfg', 'bin', 'lib'],
      '/w/py/.venv/bin': ['python', 'serve']
    }
    const pyFiles = {
      listNames: async (dir: string) => tree[dir] ?? [],
      listDirectories: async () => [],
      readText: async (path: string) =>
        path === '/w/py/pyproject.toml'
          ? '[project]\nname = "py"\n[project.scripts]\nserve = "py.cli:serve"'
          : null
    }

    const configurations = await detectProjectRunConfigurations('wt', '/w/py', true, pyFiles)

    expect(configurations.map((configuration) => configuration.command)).toEqual([
      '.venv/bin/python main.py',
      '.venv/bin/serve'
    ])
  })

  it('reads compose files together and limits a selected file to its own project', async () => {
    const tree: Record<string, string[]> = {
      '/w/stack': ['compose.yaml', 'compose.prod.yaml', 'Dockerfile', 'Dockerfile.dockerignore']
    }
    const text: Record<string, string> = {
      '/w/stack/compose.yaml': 'services:\n  api:\n    build: .',
      '/w/stack/compose.prod.yaml': 'services:\n  api:\n    restart: always',
      '/w/stack/Dockerfile': 'FROM alpine\nEXPOSE 80'
    }
    const dockerFiles = {
      listNames: async (dir: string) => tree[dir] ?? [],
      listDirectories: async () => [],
      readText: async (path: string) => text[path] ?? null
    }

    const all = await detectProjectRunConfigurations('wt', '/w/stack', true, dockerFiles)
    const prod = await detectProjectRunConfigurations(
      'wt',
      '/w/stack/compose.prod.yaml',
      false,
      dockerFiles
    )

    expect(new Set(all.map((configuration) => configuration.projectName))).toEqual(
      new Set(['compose.yaml', 'compose.prod.yaml', 'Dockerfile'])
    )
    expect(new Set(prod.map((configuration) => configuration.projectName))).toEqual(
      new Set(['compose.prod.yaml'])
    )
    expect(prod[0].command).toBe('docker compose -f compose.yaml -f compose.prod.yaml up')
  })

  it('finds nothing in a folder without projects or for an unknown worktree', async () => {
    await expect(detectProjectRunConfigurations('wt', '/w/docs', true, files)).resolves.toEqual([])
    await expect(detectProjectRunConfigurations('nope', '/w/app', true, files)).resolves.toEqual([])
  })
})

describe('mayContainRunConfigurations', () => {
  it('only probes folders and project files', () => {
    expect(mayContainRunConfigurations('src', true)).toBe(true)
    expect(mayContainRunConfigurations('package.json', false)).toBe(true)
    expect(mayContainRunConfigurations('Api.csproj', false)).toBe(true)
    expect(mayContainRunConfigurations('pyproject.toml', false)).toBe(true)
    expect(mayContainRunConfigurations('docker-compose.yml', false)).toBe(true)
    expect(mayContainRunConfigurations('Dockerfile', false)).toBe(true)
    expect(mayContainRunConfigurations('main.py', false)).toBe(false)
    expect(mayContainRunConfigurations('main.ts', false)).toBe(false)
  })
})
