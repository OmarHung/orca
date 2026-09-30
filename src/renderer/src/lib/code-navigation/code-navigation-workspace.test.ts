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
})
