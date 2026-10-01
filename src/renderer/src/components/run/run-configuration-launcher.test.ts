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
  runConfigurationAndWait: vi.fn(
    async (): Promise<{ status: string; exitCode: number | null }> => ({
      status: 'succeeded',
      exitCode: 0
    })
  ),
  debugLaunchTarget: vi.fn(async () => {}),
  confirmSharedRunConfigurations: vi.fn(async () => 'run'),
  prepareOutputFolder: vi.fn(async () => true),
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
vi.mock('./run-output-folder-cleanup', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  prepareOutputFolder: mocks.prepareOutputFolder
}))

import { cancelPendingLaunches, launchRunConfiguration } from './run-configuration-launcher'
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
        { type: 'compound', id: 'all', name: 'All', configurations: ['api', 'web'] },
        { type: 'dotnet-publish', id: 'ship', name: 'Ship', projectFile: 'api/Api.csproj' },
        { type: 'compound', id: 'release', name: 'Release', configurations: ['web', 'ship'] },
        {
          type: 'docker-export',
          id: 'export',
          name: 'Export',
          dockerfile: 'Dockerfile',
          target: 'export-web',
          outputDir: '/out/web',
          cleanOutputDir: true
        }
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
      sourceKey: 'config:api',
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

  it('marks a publish run as a publish, also inside a compound', async () => {
    await launch('release')
    expect(mocks.runConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ commandKey: 'config:ship', kind: 'publish' })
    )
    expect(mocks.runConfiguration).toHaveBeenCalledWith(
      expect.not.objectContaining({ kind: expect.anything() })
    )
  })

  it('empties a Docker export folder before exporting into it', async () => {
    await launch('export')
    expect(mocks.prepareOutputFolder).toHaveBeenCalledWith(
      'Export',
      expect.objectContaining({ commandKey: 'config:export' }),
      { folder: '/out/web', contextDir: '/repo/wt', orcaDeletes: false },
      expect.objectContaining({ cancelled: false })
    )
    expect(mocks.runConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'publish',
        command: expect.objectContaining({
          command: 'rm -rf /out/web && docker build --target export-web -o /out/web .'
        })
      })
    )
  })

  it('does not export when its folder could not be emptied', async () => {
    mocks.prepareOutputFolder.mockResolvedValueOnce(false)
    await launch('export')
    expect(mocks.runConfiguration).not.toHaveBeenCalled()
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

  it('stops starting sequential members once the launch is cancelled', async () => {
    const state = useRunConfigurationStore.getState()
    useRunConfigurationStore.setState({
      localByRepo: {
        repo1: [
          ...(state.localByRepo.repo1 ?? []),
          {
            type: 'compound',
            id: 'seq',
            name: 'Seq',
            configurations: ['build', 'web'],
            sequential: true,
            waitAfter: { build: { kind: 'exit' } }
          }
        ]
      }
    })
    let finishBuild: (exit: { status: string; exitCode: number | null }) => void = () => {}
    mocks.runConfigurationAndWait.mockImplementationOnce(
      () => new Promise((resolve) => (finishBuild = resolve))
    )
    const launched = launch('seq')
    await vi.waitFor(() => expect(mocks.runConfigurationAndWait).toHaveBeenCalled())
    cancelPendingLaunches('wt')
    finishBuild({ status: 'stopped', exitCode: null })
    await launched
    expect(mocks.runConfiguration).not.toHaveBeenCalled()
    // Why no toast: the user stopped it; a failure message would be noise.
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('lets a new launch replace one of the same configuration that is still starting', async () => {
    let finishStep: (exit: { status: string; exitCode: number | null }) => void = () => {}
    mocks.runConfigurationAndWait.mockImplementationOnce(
      () => new Promise((resolve) => (finishStep = resolve))
    )
    const first = launch('api')
    await vi.waitFor(() => expect(mocks.runConfigurationAndWait).toHaveBeenCalledTimes(1))
    const second = launch('api')
    // The rerun restarts the step, which ends the first launch's wait as stopped.
    await vi.waitFor(() => expect(mocks.runConfigurationAndWait).toHaveBeenCalledTimes(2))
    finishStep({ status: 'stopped', exitCode: null })
    await Promise.all([first, second])
    expect(mocks.debugLaunchTarget).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
