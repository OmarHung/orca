import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MONDAY_BROWSER_WORKTREE_ID } from '../../../../../../shared/local-synthetic-workspace'
import { createTestStore } from '../../../testing/app-store-test-fixture'
import { createStoreSessionMockApi } from '../../../testing/app-store-session-api.test-fixture'
import { makeBrowserTab } from '../browser-tab.test-fixture'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

createStoreSessionMockApi()

describe('hydrateBrowserSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores the monday page browser, which has no repo worktree either', () => {
    const store = createTestStore()

    store.getState().hydrateBrowserSession({
      activeRepoId: null,
      activeWorktreeId: null,
      activeTabId: null,
      tabsByWorktree: {},
      terminalLayoutsByTabId: {},
      browserTabsByWorktree: {
        [MONDAY_BROWSER_WORKTREE_ID]: [
          makeBrowserTab({
            id: 'monday-browser-1',
            worktreeId: MONDAY_BROWSER_WORKTREE_ID,
            url: 'https://acme.monday.com/boards/1'
          })
        ]
      }
    })

    expect(store.getState().browserTabsByWorktree[MONDAY_BROWSER_WORKTREE_ID]).toHaveLength(1)
  })
})
