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
  mayContainRunConfigurations
} from './project-run-detection'

const TREE: Record<string, string[]> = {
  '/w/app': ['package.json', 'pnpm-lock.yaml', 'App.csproj', 'Properties', 'README.md'],
  '/w/app/Properties': ['launchSettings.json', 'PublishProfiles'],
  '/w/app/Properties/PublishProfiles': ['Folder.pubxml', 'notes.txt']
}
const FILES: Record<string, string> = {
  '/w/app/package.json': JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite' } }),
  '/w/app/App.csproj': '<Project Sdk="Microsoft.NET.Sdk.Web" />',
  '/w/app/Properties/launchSettings.json': '{"profiles":{"App":{"commandName":"Project"}}}'
}
const files = {
  listNames: async (dir: string) => TREE[dir] ?? [],
  readText: async (path: string) => FILES[path] ?? null
}

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
    expect(mayContainRunConfigurations('main.ts', false)).toBe(false)
  })
})
