import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { useAppStore } from '@/store'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import {
  sendNativeChatMessage,
  sendNativeChatTypedCommand
} from '../native-chat/native-chat-runtime-send'

export const AGENT_CLEAR_COMMAND = '/clear'

type AgentTabPtyState = {
  ptyIdsByTabId: Record<string, readonly string[] | undefined>
  terminalLayoutsByTabId: Record<string, TerminalLayoutSnapshot | undefined>
}

/** Live PTY of the focused pane — the pane useTabAgent resolves the tab's agent from. */
export function resolveAgentTabFocusedPtyId(state: AgentTabPtyState, tabId: string): string | null {
  const livePtyIds = state.ptyIdsByTabId[tabId] ?? []
  const layout = state.terminalLayoutsByTabId[tabId]
  const leafPtyId = layout?.activeLeafId ? layout.ptyIdsByLeafId?.[layout.activeLeafId] : undefined
  if (leafPtyId && livePtyIds.includes(leafPtyId)) {
    return leafPtyId
  }
  // Why: in a split tab without a known focused pane, guessing could send /clear to a plain shell.
  return livePtyIds.length === 1 ? (livePtyIds[0] ?? null) : null
}

/** Sends /clear to the tab's agent; false when the tab has no live PTY to receive it. */
export function clearAgentTabConversation(tabId: string, agent: TuiAgent): boolean {
  const ptyId = resolveAgentTabFocusedPtyId(useAppStore.getState(), tabId)
  if (!ptyId) {
    return false
  }
  const settings = getSettingsForAgentTabRuntimeOwner(tabId)
  // Why: same routing as the native chat composer — Codex only runs slash commands typed key by key.
  if (agent === 'codex') {
    sendNativeChatTypedCommand(settings, ptyId, AGENT_CLEAR_COMMAND)
  } else {
    sendNativeChatMessage(settings, ptyId, AGENT_CLEAR_COMMAND)
  }
  return true
}
