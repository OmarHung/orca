import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const ptyIdsByTabId: Record<string, string[]> = {}
  const terminalLayoutsByTabId: Record<string, unknown> = {}
  const tabsByWorktree: Record<string, { id: string; title: string }[]> = {}
  return {
    state: {
      ptyIdsByTabId,
      terminalLayoutsByTabId,
      tabsByWorktree,
      agentStatusByPaneKey: {},
      agentStatusEpoch: 0,
      runtimePaneTitlesByTabId: {}
    },
    activityStatus: 'done',
    settings: { activeRuntimeEnvironmentId: null },
    sendNativeChatMessage: vi.fn(),
    sendNativeChatTypedCommand: vi.fn()
  }
})

vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.state }
}))
vi.mock('@/lib/agent-paste-draft', () => ({
  getSettingsForAgentTabRuntimeOwner: () => mocks.settings
}))
vi.mock('../native-chat/native-chat-runtime-send', () => ({
  sendNativeChatMessage: mocks.sendNativeChatMessage,
  sendNativeChatTypedCommand: mocks.sendNativeChatTypedCommand
}))
vi.mock('./terminal-tab-activity-status', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTerminalTabActivityStatus: vi.fn(() => mocks.activityStatus)
}))

import { clearAgentTabConversation, resolveAgentTabFocusedPtyId } from './agent-tab-clear'
import { resolveTerminalTabActivityStatus } from './terminal-tab-activity-status'

function layout(activeLeafId: string | null, ptyIdsByLeafId: Record<string, string>) {
  return { root: null, activeLeafId, expandedLeafId: null, ptyIdsByLeafId }
}

describe('resolveAgentTabFocusedPtyId', () => {
  it('returns the focused leaf PTY when it is live', () => {
    const state = {
      ptyIdsByTabId: { tab: ['pty-a', 'pty-b'] },
      terminalLayoutsByTabId: { tab: layout('leaf-b', { 'leaf-a': 'pty-a', 'leaf-b': 'pty-b' }) }
    }

    expect(resolveAgentTabFocusedPtyId(state, 'tab')).toBe('pty-b')
  })

  it('ignores a focused leaf PTY that is no longer live', () => {
    const state = {
      ptyIdsByTabId: { tab: ['pty-a'] },
      terminalLayoutsByTabId: { tab: layout('leaf-b', { 'leaf-b': 'pty-gone' }) }
    }

    expect(resolveAgentTabFocusedPtyId(state, 'tab')).toBe('pty-a')
  })

  it('refuses to guess between split panes without a focused leaf', () => {
    const state = {
      ptyIdsByTabId: { tab: ['pty-a', 'pty-b'] },
      terminalLayoutsByTabId: {}
    }

    expect(resolveAgentTabFocusedPtyId(state, 'tab')).toBeNull()
  })

  it('returns null for a tab with no live PTY', () => {
    expect(
      resolveAgentTabFocusedPtyId({ ptyIdsByTabId: {}, terminalLayoutsByTabId: {} }, 'tab')
    ).toBe(null)
  })
})

describe('clearAgentTabConversation', () => {
  beforeEach(() => {
    mocks.state.ptyIdsByTabId = { tab: ['pty-1'] }
    mocks.state.terminalLayoutsByTabId = {}
    mocks.state.tabsByWorktree = { wt: [{ id: 'tab', title: 'Claude' }] }
    mocks.activityStatus = 'done'
    mocks.sendNativeChatMessage.mockReset()
    mocks.sendNativeChatTypedCommand.mockReset()
  })

  function expectNothingSent(): void {
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
    expect(mocks.sendNativeChatTypedCommand).not.toHaveBeenCalled()
  }

  it('sends /clear to Claude as a submitted message', () => {
    expect(clearAgentTabConversation('tab', 'claude', 'pty-1')).toBe('sent')

    expect(mocks.sendNativeChatMessage).toHaveBeenCalledWith(mocks.settings, 'pty-1', '/clear')
    expect(mocks.sendNativeChatTypedCommand).not.toHaveBeenCalled()
    expect(resolveTerminalTabActivityStatus).toHaveBeenCalledWith(
      expect.objectContaining({ tab: { id: 'tab', title: 'Claude' } })
    )
  })

  it('types /clear key by key for Codex', () => {
    expect(clearAgentTabConversation('tab', 'codex', 'pty-1')).toBe('sent')

    expect(mocks.sendNativeChatTypedCommand).toHaveBeenCalledWith(mocks.settings, 'pty-1', '/clear')
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
  })

  it('sends nothing once the tab has no live PTY', () => {
    mocks.state.ptyIdsByTabId = {}

    expect(clearAgentTabConversation('tab', 'claude', 'pty-1')).toBe('changed')
    expectNothingSent()
  })

  it('sends nothing when the confirmed PTY is no longer the focused one', () => {
    mocks.state.ptyIdsByTabId = { tab: ['pty-2'] }

    expect(clearAgentTabConversation('tab', 'claude', 'pty-1')).toBe('changed')
    expectNothingSent()
  })

  it.each(['working', 'monitoring', 'permission'])(
    'sends nothing while the agent is %s at send time',
    (status) => {
      mocks.activityStatus = status

      expect(clearAgentTabConversation('tab', 'claude', 'pty-1')).toBe('busy')
      expectNothingSent()
    }
  )

  it('sends nothing when the tab is gone from the store', () => {
    mocks.state.tabsByWorktree = {}

    expect(clearAgentTabConversation('tab', 'claude', 'pty-1')).toBe('busy')
    expectNothingSent()
  })
})
