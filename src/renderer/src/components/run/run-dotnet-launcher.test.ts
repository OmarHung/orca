// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appState: {
    settings: { dotnetContainerToolchain: true, terminalDefaultShell: '' },
    worktreesByRepo: { repo1: [{ id: 'wt', repoId: 'repo1', path: '/repo/wt' }] },
    repos: [{ id: 'repo1', path: '/repo', displayName: 'Repo' }]
  },
  needsLauncher: vi.fn(async (_input: { cwd: string; command: string }) => true)
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.appState } }))
vi.mock('@/store/slices/worktree-helpers', () => ({
  findWorktreeById: (byRepo: Record<string, { id: string }[]>, id: string) =>
    Object.values(byRepo)
      .flat()
      .find((worktree) => worktree.id === id)
}))
vi.mock('@/runtime/runtime-client-target', () => ({
  getActiveRuntimeTarget: () => ({ kind: 'local' })
}))
vi.mock('../debug/debug-launch', () => ({ isLocalDebugTarget: () => true }))

import { prepareDotnetLauncher, runCommandText } from './run-dotnet-launcher'
import type { RunTarget } from './run-target'

const LAUNCHER = '/Users/me/Library/Application Support/orca/dotnet-container/bin/dotnet'

function target(command: string, cwd?: string): RunTarget {
  return {
    worktreeId: 'wt',
    groupId: null,
    commandKey: `key:${command}`,
    command: { id: command, label: 'Run', command, appendEnter: true },
    ...(cwd ? { cwd } : {})
  }
}

beforeEach(() => {
  mocks.needsLauncher.mockReset()
  Object.assign(window, {
    api: {
      dotnetContainer: {
        launcherPath: async () => LAUNCHER,
        needsLauncher: mocks.needsLauncher
      }
    }
  })
})

describe('Run commands and the .NET container launcher', () => {
  it('types the launcher only for a project that runs in the container', async () => {
    mocks.needsLauncher.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const legacy = target('dotnet run --project Legacy.csproj', 'src/Legacy')
    const modern = target('dotnet run --project Api.csproj')

    await prepareDotnetLauncher(legacy)
    await prepareDotnetLauncher(modern)

    expect(mocks.needsLauncher).toHaveBeenNthCalledWith(1, {
      cwd: '/repo/wt/src/Legacy',
      command: 'dotnet run --project Legacy.csproj'
    })
    expect(runCommandText(legacy)).toBe(`'${LAUNCHER}' run --project Legacy.csproj`)
    expect(runCommandText(modern)).toBe('dotnet run --project Api.csproj')
  })

  it('falls back to the launcher, which decides itself, when the question fails', async () => {
    mocks.needsLauncher.mockRejectedValueOnce(new Error('ipc failed'))
    const run = target('dotnet build')
    await prepareDotnetLauncher(run)
    expect(runCommandText(run)).toBe(`'${LAUNCHER}' build`)
  })

  it('leaves commands that do not start with dotnet alone, without asking', async () => {
    expect(prepareDotnetLauncher(target('npm run dev'))).toBeNull()
    expect(mocks.needsLauncher).not.toHaveBeenCalled()
  })
})
