import type { TuiAgent } from '../../../../shared/tui-agent'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getSettingsForAgentTabRuntimeOwner } from '@/lib/agent-paste-draft'
import {
  sendNativeChatMessage,
  sendNativeChatTypedCommand
} from '../native-chat/native-chat-runtime-send'
import {
  isTerminalTabActivityLive,
  resolveTerminalTabActivityStatus
} from './terminal-tab-activity-status'

export const AGENT_CLEAR_COMMAND = '/clear'

type AgentTabPtyState = Pick<AppState, 'ptyIdsByTabId' | 'terminalLayoutsByTabId'>

type AgentTabClearState = AgentTabPtyState &
  Pick<
    AppState,
    'tabsByWorktree' | 'agentStatusByPaneKey' | 'agentStatusEpoch' | 'runtimePaneTitlesByTabId'
  >

export type AgentTabClearOutcome = 'sent' | 'busy' | 'changed'

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

/** The PTY a clear would go to right now; null when the tab has none safe to type into. */
export function resolveAgentTabClearTarget(tabId: string): string | null {
  return resolveAgentTabFocusedPtyId(useAppStore.getState(), tabId)
}

/** Mid-turn or on a prompt, where the submit Enter could answer the prompt instead. */
export function isAgentTabBusy(state: AgentTabClearState, tabId: string): boolean {
  const tab = Object.values(state.tabsByWorktree)
    .flat()
    .find((candidate) => candidate.id === tabId)
  if (!tab) {
    return true
  }
  const status = resolveTerminalTabActivityStatus({
    tab,
    agentStatusByPaneKey: state.agentStatusByPaneKey,
    agentStatusEpoch: state.agentStatusEpoch,
    runtimePaneTitlesByTabId: state.runtimePaneTitlesByTabId,
    ptyIdsByTabId: state.ptyIdsByTabId,
    terminalLayout: state.terminalLayoutsByTabId[tabId]
  })
  return isTerminalTabActivityLive(status)
}

/**
 * Sends /clear to `ptyId` only while it is still the tab's focused live PTY and the agent is idle,
 * read from the store at send time rather than from what was rendered when the user clicked.
 */
export function clearAgentTabConversation(
  tabId: string,
  agent: TuiAgent,
  ptyId: string
): AgentTabClearOutcome {
  const state = useAppStore.getState()
  if (resolveAgentTabFocusedPtyId(state, tabId) !== ptyId) {
    return 'changed'
  }
  if (isAgentTabBusy(state, tabId)) {
    return 'busy'
  }
  const settings = getSettingsForAgentTabRuntimeOwner(tabId)
  // Why: same routing as the native chat composer — Codex only runs slash commands typed key by key.
  if (agent === 'codex') {
    sendNativeChatTypedCommand(settings, ptyId, AGENT_CLEAR_COMMAND)
  } else {
    sendNativeChatMessage(settings, ptyId, AGENT_CLEAR_COMMAND)
  }
  return 'sent'
}
