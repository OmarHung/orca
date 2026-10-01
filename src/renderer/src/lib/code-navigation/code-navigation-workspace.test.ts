import { describe, expect, it } from 'vitest'
import { resolveCodeNavigationContext } from './code-navigation-workspace'
import { toEditorModelUri } from '@/components/editor/editor-model-uri'

type StateOverrides = {
  repoExecutionHostId?: string
  activeRuntimeEnvironmentId?: string | null
  worktreePath?: string
  tab?: Record<string, unknown>
}

function state(overrides: StateOverrides = {}) {
  const worktreePath = overrides.worktreePath ?? '/repo'
  return {
    openFiles: [
      {
        id: 'tab-1',
        filePath: `${worktreePath}/src/app.ts`,
        relativePath: 'src/app.ts',
        worktreeId: 'wt-1',
        language: 'typescript',
        mode: 'edit',
        isDirty: false,
        ...overrides.tab
      }
    ],
    worktreesByRepo: { 'repo-1': [{ id: 'wt-1', repoId: 'repo-1', path: worktreePath }] },
    repos: [
      {
        id: 'repo-1',
        path: worktreePath,
        ...(overrides.repoExecutionHostId ? { executionHostId: overrides.repoExecutionHostId } : {})
      }
    ],
    folderWorkspaces: [],
    projectGroups: [],
    settings: { activeRuntimeEnvironmentId: overrides.activeRuntimeEnvironmentId ?? null }
  }
}

function resolve(overrides: StateOverrides = {}, modelPath?: string) {
  const current = state(overrides)
  const path = modelPath ?? String(current.openFiles[0].filePath)
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the fields built above.
  return resolveCodeNavigationContext(current as never, toEditorModelUri(path))
}

describe('resolveCodeNavigationContext', () => {
  it('resolves a local worktree file to its server and root', () => {
    expect(resolve()).toMatchObject({
      kind: 'typescript',
      languageId: 'typescript',
      root: '/repo',
      tab: { id: 'tab-1' }
    })
  })

  it('ignores models that no edit tab shows', () => {
    expect(resolve({}, '/repo/src/other.ts')).toBeNull()
    expect(resolve({ tab: { mode: 'diff' } })).toBeNull()
  })

  it('leaves remote runtimes, SSH repos and WSL paths to Monaco', () => {
    expect(resolve({ tab: { runtimeEnvironmentId: 'env-1' } })).toBeNull()
    expect(resolve({ activeRuntimeEnvironmentId: 'env-1' })).toBeNull()
    expect(resolve({ repoExecutionHostId: 'ssh:target-1' })).toBeNull()
    expect(resolve({ worktreePath: '//wsl$/Ubuntu/home/me/repo' })).toBeNull()
  })

  it('ignores files outside the workspace root and files no server handles', () => {
    expect(resolve({ tab: { filePath: '/elsewhere/app.ts' } })).toBeNull()
    expect(resolve({ tab: { filePath: '/repo/README.md' } })).toBeNull()
  })

  it('resolves a local folder workspace to its folder', () => {
    const folderState = {
      ...state({ tab: { worktreeId: 'folder:f-1', filePath: '/notes/app.cs' } }),
      folderWorkspaces: [
        { id: 'f-1', projectGroupId: 'g-1', folderPath: '/notes', executionHostId: 'local' }
      ]
    }
    const sshFolderState = {
      ...folderState,
      folderWorkspaces: [
        { id: 'f-1', projectGroupId: 'g-1', folderPath: '/notes', connectionId: 'target-1' }
      ]
    }
    const modelUri = toEditorModelUri('/notes/app.cs')

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the fields built above.
    expect(resolveCodeNavigationContext(folderState as never, modelUri)).toMatchObject({
      kind: 'csharp',
      root: '/notes'
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
    expect(resolveCodeNavigationContext(sshFolderState as never, modelUri)).toBeNull()
  })

  describe('with a project nested in another (a repo at the home folder)', () => {
    const filePath = '/home/shop/src/app.ts'
    const tab = (worktreeId: string) => ({
      id: `editor:${worktreeId}:${filePath}`,
      filePath,
      relativePath: 'src/app.ts',
      worktreeId,
      language: 'typescript',
      mode: 'edit',
      isDirty: false
    })
    function nestedState(active: { worktreeId: string; fileId?: string }) {
      return {
        openFiles: [tab('wt-home'), tab('wt-shop')],
        activeWorktreeId: active.worktreeId,
        activeFileId: active.fileId ?? null,
        worktreesByRepo: {
          'repo-home': [{ id: 'wt-home', repoId: 'repo-home', path: '/home' }],
          'repo-shop': [{ id: 'wt-shop', repoId: 'repo-shop', path: '/home/shop' }]
        },
        repos: [
          { id: 'repo-home', path: '/home' },
          { id: 'repo-shop', path: '/home/shop' }
        ],
        folderWorkspaces: [],
        projectGroups: [],
        settings: { activeRuntimeEnvironmentId: null }
      }
    }
    const resolveIn = (active: { worktreeId: string; fileId?: string }) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the resolver reads only the fields built above.
      resolveCodeNavigationContext(nestedState(active) as never, toEditorModelUri(filePath))

    it('uses the tab of the active project when both show the file', () => {
      expect(resolveIn({ worktreeId: 'wt-shop' })?.tab.worktreeId).toBe('wt-shop')
      expect(resolveIn({ worktreeId: 'wt-home' })?.tab.worktreeId).toBe('wt-home')
      expect(
        resolveIn({ worktreeId: 'wt-other', fileId: `editor:wt-home:${filePath}` })?.tab.worktreeId
      ).toBe('wt-home')
    })

    it('never sends language-server-owned sources to a server inside the home project', () => {
      const paths = [
        '/home/Library/Application Support/orca/language-servers/csharp-metadata/MediatR-1/MediatR.ISender.cs',
        '/home/Library/Application Support/orca/language-servers/typescript-native/7/package/lib/lib.dom.d.ts'
      ]
      for (const filePath of paths) {
        const state = {
          ...nestedState({ worktreeId: 'wt-home' }),
          openFiles: [{ ...tab('wt-home'), id: 'server-source', filePath }]
        }
        expect(
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: as above.
          resolveCodeNavigationContext(state as never, toEditorModelUri(filePath))
        ).toBeNull()
      }
    })

    it('roots the server at the innermost project, not the home folder', () => {
      expect(resolveIn({ worktreeId: 'wt-home' })?.root).toBe('/home/shop')
      expect(resolveIn({ worktreeId: 'wt-shop' })?.root).toBe('/home/shop')
    })
  })
})
