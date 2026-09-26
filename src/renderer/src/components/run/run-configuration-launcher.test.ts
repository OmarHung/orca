// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appState: {
    worktreesByRepo: { repo1: [{ id: 'wt', repoId: 'repo1', path: '/repo/wt' }] },
    repos: [{ id: 'repo1', path: '/repo', displayName: 'Repo' }],
    activeFileIdByWorktree: {},
    openFiles: []
  },
  runConfiguration: vi.fn(async () => {}),
  runConfigurationAndWait: vi.fn(async () => ({ status: 'succeeded', exitCode: 0 })),
  debugLaunchTarget: vi.fn(async () => {}),
  confirmSharedRunConfigurations: vi.fn(async () => 'run'),
  toastError: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.appState } }))
vi.mock('@/store/slices/worktree-helpers', () => ({
  findWorktreeById: (byRepo: Record<string, { id: string }[]>, id: string) =>
    Object.values(byRepo)
      .flat()
      .find((worktree) => worktree.id === id)
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/lib/ensure-hooks-confirmed', () => ({
  confirmSharedRunConfigurations: mocks.confirmSharedRunConfigurations
}))
vi.mock('../debug/debug-launch', () => ({ debugLaunchTarget: mocks.debugLaunchTarget }))
vi.mock('./project-run-detection', () => ({ worktreeProjectFiles: () => null }))
vi.mock('./run-configuration-control', () => ({
  runConfiguration: mocks.runConfiguration,
  runConfigurationAndWait: mocks.runConfigurationAndWait
}))

import { launchRunConfiguration } from './run-configuration-launcher'
import { useRunConfigurationStore } from './run-configuration-store'

const launch = (reference: string) =>
  launchRunConfiguration({ worktreeId: 'wt', groupId: 'g', reference })

beforeEach(() => {
  vi.clearAllMocks()
  useRunConfigurationStore.setState({
    localByRepo: {
      repo1: [
        { type: 'command', id: 'build', name: 'Build', command: 'make', cwd: 'src' },
        {
          type: 'debug',
          id: 'api',
          name: 'API',
          target: { kind: 'dotnet-program', program: 'bin/Api.dll' },
          env: { PORT: '5000' },
          beforeLaunch: ['build']
        },
        { type: 'command', id: 'web', name: 'Web', command: 'pnpm dev' },
        { type: 'compound', id: 'all', name: 'All', configurations: ['api', 'web'] }
      ]
    },
    selectedByRepo: {},
    sharedByWorktree: {
      wt: {
        status: 'ready',
        problems: [],
        configurations: [{ type: 'command', id: 'Lint', name: 'Lint', command: 'pnpm lint' }]
      }
    }
  })
})

describe('launchRunConfiguration', () => {
  it('runs Before launch steps, then debugs with resolved paths', async () => {
    await launch('api')
    expect(mocks.runConfigurationAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        commandKey: 'config:build',
        cwd: '/repo/wt/src',
        command: expect.objectContaining({ command: 'make', label: 'Build' })
      })
    )
    expect(mocks.debugLaunchTarget).toHaveBeenCalledWith({
      worktreeId: 'wt',
      title: 'API',
      target: { kind: 'dotnet-program', program: '/repo/wt/bin/Api.dll' },
      cwd: '/repo/wt',
      launchOptions: { env: { PORT: '5000' } }
    })
    expect(mocks.confirmSharedRunConfigurations).not.toHaveBeenCalled()
  })

  it('does not launch when a Before launch step fails', async () => {
    mocks.runConfigurationAndWait.mockResolvedValueOnce({ status: 'failed', exitCode: 1 })
    await launch('api')
    expect(mocks.debugLaunchTarget).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
  })

  it('starts every compound member', async () => {
    await launch('all')
    expect(mocks.debugLaunchTarget).toHaveBeenCalledTimes(1)
    expect(mocks.runConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ commandKey: 'config:web' })
    )
  })

  it('asks for trust before running an orca.yaml configuration', async () => {
    mocks.confirmSharedRunConfigurations.mockResolvedValueOnce('skip')
    await launch('Lint')
    expect(mocks.confirmSharedRunConfigurations).toHaveBeenCalledWith(
      mocks.appState,
      'repo1',
      expect.stringContaining('pnpm lint'),
      expect.anything()
    )
    expect(mocks.runConfiguration).not.toHaveBeenCalled()
  })

  it('explains a missing reference', async () => {
    await launch('nope')
    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringContaining('nope'))
  })

  it('asks for trust when a local compound goes through a shared one', async () => {
    const state = useRunConfigurationStore.getState()
    useRunConfigurationStore.setState({
      localByRepo: {
        repo1: [
          ...(state.localByRepo.repo1 ?? []),
          { type: 'compound', id: 'outer', name: 'Outer', configurations: ['Shared group'] }
        ]
      },
      sharedByWorktree: {
        wt: {
          status: 'ready',
          problems: [],
          configurations: [
            { type: 'compound', id: 'Shared group', name: 'Shared group', configurations: ['web'] }
          ]
        }
      }
    })
    mocks.confirmSharedRunConfigurations.mockResolvedValueOnce('skip')
    await launch('outer')
    expect(mocks.confirmSharedRunConfigurations).toHaveBeenCalled()
    expect(mocks.runConfiguration).not.toHaveBeenCalled()
  })
})
