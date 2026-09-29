import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const ptyIdsByTabId: Record<string, string[]> = {}
  const terminalLayoutsByTabId: Record<string, unknown> = {}
  return {
    state: { ptyIdsByTabId, terminalLayoutsByTabId },
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

import { clearAgentTabConversation, resolveAgentTabFocusedPtyId } from './agent-tab-clear'

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
    mocks.sendNativeChatMessage.mockReset()
    mocks.sendNativeChatTypedCommand.mockReset()
  })

  it('sends /clear to Claude as a submitted message', () => {
    expect(clearAgentTabConversation('tab', 'claude')).toBe(true)

    expect(mocks.sendNativeChatMessage).toHaveBeenCalledWith(mocks.settings, 'pty-1', '/clear')
    expect(mocks.sendNativeChatTypedCommand).not.toHaveBeenCalled()
  })

  it('types /clear key by key for Codex', () => {
    expect(clearAgentTabConversation('tab', 'codex')).toBe(true)

    expect(mocks.sendNativeChatTypedCommand).toHaveBeenCalledWith(mocks.settings, 'pty-1', '/clear')
    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
  })

  it('sends nothing when the tab has no live PTY', () => {
    mocks.state.ptyIdsByTabId = {}

    expect(clearAgentTabConversation('tab', 'claude')).toBe(false)

    expect(mocks.sendNativeChatMessage).not.toHaveBeenCalled()
    expect(mocks.sendNativeChatTypedCommand).not.toHaveBeenCalled()
  })
})
