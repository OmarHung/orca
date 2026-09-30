import { describe, expect, it, vi } from 'vitest'
import { createEditorStore } from './editor-slice-test-harness'
import { buildEditorSessionData } from '@/lib/workspace-session'
import type { OpenFile } from './editor'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const DECOMPILED =
  '/home/me/Library/Application Support/orca/language-servers/csharp-metadata/A-1/A.cs'

describe('code-navigation tabs that stay in the workspace that opened them', () => {
  it('persists the flag only when set', () => {
    const tab = (overrides: Partial<OpenFile>): OpenFile => ({
      id: overrides.filePath ?? DECOMPILED,
      filePath: DECOMPILED,
      relativePath: DECOMPILED,
      worktreeId: 'wt-1',
      language: 'csharp',
      isDirty: false,
      mode: 'edit',
      ...overrides
    })

    const session = buildEditorSessionData(
      [tab({ staysInOpeningWorkspace: true }), tab({ filePath: '/elsewhere/B.cs' })],
      {},
      {},
      {},
      {}
    )

    expect(session.openFilesByWorktree['wt-1']).toEqual([
      expect.objectContaining({ filePath: DECOMPILED, staysInOpeningWorkspace: true }),
      expect.not.objectContaining({ staysInOpeningWorkspace: expect.anything() })
    ])
  })

  it('restores the flag with the tab', () => {
    const store = createEditorStore()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the hydrator reads only these fields.
    store.setState({
      worktreesByRepo: { 'repo-1': [{ id: 'wt-1' }] },
      folderWorkspaces: []
    } as never)

    const session = {
      openFilesByWorktree: {
        'wt-1': [
          {
            filePath: DECOMPILED,
            relativePath: DECOMPILED,
            worktreeId: 'wt-1',
            language: 'csharp',
            readOnly: true,
            staysInOpeningWorkspace: true
          }
        ]
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a minimal persisted session.
    store.getState().hydrateEditorSession(session as never)

    expect(store.getState().openFiles[0]).toEqual(
      expect.objectContaining({ staysInOpeningWorkspace: true, readOnly: true })
    )
  })
})
