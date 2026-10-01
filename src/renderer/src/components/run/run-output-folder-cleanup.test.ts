import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const fileContext: { connectionId?: string } = {}
  return {
    appState: { worktreesByRepo: { repo1: [{ id: 'wt', repoId: 'repo1', path: '/repo/wt' }] } },
    fileContext,
    pathExists: vi.fn(async () => true),
    deletePath: vi.fn(async () => {}),
    authorizeExternalPath: vi.fn(async () => {}),
    stopConfigurationAndWait: vi.fn(async () => {}),
    toastError: vi.fn()
  }
})

vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.appState } }))
vi.mock('@/store/slices/worktree-helpers', () => ({
  findWorktreeById: (byRepo: Record<string, { id: string }[]>, id: string) =>
    Object.values(byRepo)
      .flat()
      .find((worktree) => worktree.id === id)
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/runtime/runtime-file-metadata-client', () => ({ runtimePathExists: mocks.pathExists }))
vi.mock('@/runtime/runtime-file-mutation-client', () => ({ deleteRuntimePath: mocks.deletePath }))
vi.mock('../tab-bar/tab-create-entry-local-path', () => ({
  getTabEntryFileOperationContext: () => mocks.fileContext
}))
vi.mock('./run-configuration-control', () => ({
  stopConfigurationAndWait: mocks.stopConfigurationAndWait
}))

import {
  emptyOutputFolder,
  outputFoldersToEmpty,
  prepareOutputFolder
} from './run-output-folder-cleanup'

const OUT = { folder: '/Users/me/deploy/web', contextDir: '/repo/wt', orcaDeletes: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fileContext.connectionId = undefined
  vi.stubGlobal('window', { api: { fs: { authorizeExternalPath: mocks.authorizeExternalPath } } })
})

describe('outputFoldersToEmpty', () => {
  it('resolves the folders of exports that empty them first', () => {
    const folders = outputFoldersToEmpty(
      [
        {
          type: 'docker-export',
          id: 'a',
          name: 'A',
          dockerfile: 'web/Dockerfile',
          target: 'export',
          outputDir: 'publish/web',
          cleanOutputDir: true
        },
        {
          type: 'docker-export',
          id: 'b',
          name: 'B',
          dockerfile: 'Dockerfile',
          target: 'export',
          outputDir: 'publish/b'
        }
      ],
      { workspaceFolder: '/repo/wt' },
      { orcaDeletes: false }
    )

    expect([...folders]).toEqual([
      ['a', { folder: '/repo/wt/publish/web', contextDir: '/repo/wt/web', orcaDeletes: false }]
    ])
  })
})

describe('emptyOutputFolder', () => {
  it('moves an existing folder away on the workspace host', async () => {
    await expect(emptyOutputFolder('wt', 'Export', OUT)).resolves.toBe(true)
    expect(mocks.authorizeExternalPath).toHaveBeenCalledWith({ targetPath: OUT.folder })
    expect(mocks.deletePath).toHaveBeenCalledWith(mocks.fileContext, OUT.folder, true)
  })

  it('has nothing to do for a folder that does not exist yet', async () => {
    mocks.pathExists.mockResolvedValueOnce(false)
    await expect(emptyOutputFolder('wt', 'Export', OUT)).resolves.toBe(true)
    expect(mocks.deletePath).not.toHaveBeenCalled()
  })

  it('needs no local permission on an SSH host', async () => {
    mocks.fileContext.connectionId = 'ssh-1'
    await emptyOutputFolder('wt', 'Export', OUT)
    expect(mocks.authorizeExternalPath).not.toHaveBeenCalled()
    expect(mocks.deletePath).toHaveBeenCalled()
  })

  it('refuses a folder holding the workspace, and says why', async () => {
    await expect(
      emptyOutputFolder('wt', 'Export', { ...OUT, folder: '/repo', contextDir: '/repo/wt' })
    ).resolves.toBe(false)
    expect(mocks.deletePath).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
  })

  it('reports a failed delete', async () => {
    mocks.deletePath.mockRejectedValueOnce(new Error('busy'))
    await expect(emptyOutputFolder('wt', 'Export', OUT)).resolves.toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith(expect.any(String), { description: 'busy' })
  })
})

describe('prepareOutputFolder', () => {
  const target = {
    worktreeId: 'wt',
    groupId: null,
    commandKey: 'config:x',
    command: { id: 'config:x', label: 'X', command: 'docker build', appendEnter: true }
  }

  it('stops the previous export before emptying its folder', async () => {
    await expect(prepareOutputFolder('X', target, OUT, { cancelled: false })).resolves.toBe(true)
    expect(mocks.stopConfigurationAndWait).toHaveBeenCalledWith(target)
    expect(mocks.deletePath).toHaveBeenCalled()
  })

  it("only checks the folder when the command's own rm -rf empties it", async () => {
    const shellEmpties = { ...OUT, orcaDeletes: false }
    await expect(
      prepareOutputFolder('X', target, shellEmpties, { cancelled: false })
    ).resolves.toBe(true)
    expect(mocks.stopConfigurationAndWait).not.toHaveBeenCalled()
    expect(mocks.deletePath).not.toHaveBeenCalled()
    await expect(
      prepareOutputFolder(
        'X',
        target,
        { ...shellEmpties, folder: '/Users/me' },
        { cancelled: false }
      )
    ).resolves.toBe(false)
    expect(mocks.toastError).toHaveBeenCalled()
  })

  it('leaves runs without an output folder alone', async () => {
    await expect(prepareOutputFolder('X', target, undefined, { cancelled: false })).resolves.toBe(
      true
    )
    expect(mocks.stopConfigurationAndWait).not.toHaveBeenCalled()
  })
})
