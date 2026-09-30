import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runQuickCommandInNewTab } from './run-quick-command-in-new-tab'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(() => ({ id: 'tab-new' }))
}))

vi.mock('@/store/index', () => ({
  useAppStore: {
    getState: () => ({
      createTab: mocks.createTab,
      setActiveTabType: vi.fn(),
      setTabBarOrder: vi.fn(),
      setRecentQuickCommandForGroup: vi.fn(),
      tabsByWorktree: { 'wt-1': [{ id: 'tab-new' }] },
      unifiedTabsByWorktree: {
        'wt-1': [
          { id: 'tab-new', entityId: 'tab-new', contentType: 'terminal', groupId: 'group-1' }
        ]
      },
      activeGroupIdByWorktree: { 'wt-1': 'group-1' },
      openFiles: [],
      browserTabsByWorktree: {},
      tabBarOrderByWorktree: {}
    })
  }
}))
vi.mock('@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: vi.fn()
}))
vi.mock('../../../../../shared/non-secure-context-uuid', () => ({
  createNonSecureContextUuid: () => '11111111-1111-4111-8111-111111111111'
}))

describe('runQuickCommandInNewTab', () => {
  beforeEach(() => {
    mocks.createTab.mockClear()
  })

  it('returns the new pane leaf id and seeds the tab with it', () => {
    const result = runQuickCommandInNewTab({
      command: {
        id: 'build',
        label: 'Build',
        action: 'terminal-command',
        command: 'cd packages\nbun run build\ncd ..',
        appendEnter: true
      },
      worktreeId: 'wt-1',
      groupId: 'group-1'
    })

    expect(result).toEqual({
      tabId: 'tab-new',
      leafId: '11111111-1111-4111-8111-111111111111'
    })
    expect(mocks.createTab).toHaveBeenCalledWith('wt-1', 'group-1', undefined, {
      quickCommandLabel: 'Build',
      initialLeafId: '11111111-1111-4111-8111-111111111111',
      pendingStartup: { command: 'cd packages; bun run build; cd ..' }
    })
  })
})
