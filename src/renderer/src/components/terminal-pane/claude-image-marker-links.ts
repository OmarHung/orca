import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { useAppStore } from '@/store'
import type { AgentType } from '../../../../shared/agent-status-types'
import { translate } from '@/i18n/i18n'
import {
  useTerminalImagePreviewStore,
  type TerminalImagePreviewRequest
} from '@/store/terminal-image-preview'
import { CLAUDE_IMAGE_MARKER_PATTERN } from '../../../../shared/claude-pasted-image'
import { resolveNativeChatTranscriptAgent } from '../../../../shared/native-chat-agent-support'
import { buildWrappedLogicalLine, rangeForParsedFileLink } from './wrapped-terminal-link-ranges'
import {
  isTerminalLinkActionActivation,
  isTerminalLinkDirectActivation
} from './terminal-link-activation'
import { isMacPlatform } from './terminal-link-open-hints'
import {
  requestTerminalLinkAction,
  type TerminalLinkActionContext
} from './terminal-link-action-request'

const MARKER_PREFIX = '[Image #'

export type ParsedClaudeImageMarker = {
  pasteId: number
  text: string
  startIndex: number
  endIndex: number
}

export function extractClaudeImageMarkers(lineText: string): ParsedClaudeImageMarker[] {
  if (!lineText.includes(MARKER_PREFIX)) {
    return []
  }
  return [...lineText.matchAll(CLAUDE_IMAGE_MARKER_PATTERN)]
    .map((match) => ({
      pasteId: Number(match[1]),
      text: match[0],
      startIndex: match.index,
      endIndex: match.index + match[0].length
    }))
    .filter((marker) => Number.isSafeInteger(marker.pasteId) && marker.pasteId > 0)
}

type ClaudeImageMarkerPane = Omit<TerminalImagePreviewRequest, 'pasteId' | 'canReadTranscript'>

/** The slice of app state that identifies a pane's agent session. */
export type ClaudeImageMarkerPaneState = {
  agentStatusByPaneKey: Readonly<
    Record<
      string,
      | { agentType?: AgentType; providerSession?: { id: string; transcriptPath?: string } }
      | undefined
    >
  >
  paneForegroundAgentByPaneKey: Readonly<Record<string, { agent: string | null } | undefined>>
}

/** The pane's Claude session, or null when the pane is not running Claude Code
 *  (other agents paint different chips and their transcripts carry no paste ids). */
export function resolveClaudeImageMarkerPane(
  state: ClaudeImageMarkerPaneState,
  paneKey: string
): ClaudeImageMarkerPane | null {
  const entry = state.agentStatusByPaneKey[paneKey]
  const agent = entry?.agentType ?? state.paneForegroundAgentByPaneKey[paneKey]?.agent ?? null
  if (!agent || resolveNativeChatTranscriptAgent(agent) !== 'claude') {
    return null
  }
  return {
    paneKey,
    agent,
    sessionId: entry?.providerSession?.id ?? null,
    transcriptPath: entry?.providerSession?.transcriptPath ?? null
  }
}

type ClaudeImageMarkerLinkProviderDeps = {
  getTerminal: () => Pick<Terminal, 'buffer' | 'clearSelection'> | null
  getPaneKey: () => string | null
  isRuntimeOwned: () => boolean
  linkTooltip: { textContent: string | null; style: { display: string } }
  getLinkActionContext?: () => TerminalLinkActionContext | null
}

function previewHint(showActions: boolean): string {
  const shortcut = isMacPlatform() ? '⌘+click' : 'Ctrl+click'
  return showActions
    ? translate(
        'components.terminalPane.imagePreview.linkHintWithActions',
        'Click for actions or {{shortcut}} to preview',
        { shortcut }
      )
    : translate('components.terminalPane.imagePreview.linkHint', '{{shortcut}} to preview', {
        shortcut
      })
}

export function createClaudeImageMarkerLinkProvider(
  deps: ClaudeImageMarkerLinkProviderDeps
): ILinkProvider {
  const resolvePane = (): ClaudeImageMarkerPane | null => {
    const paneKey = deps.getPaneKey()
    return paneKey ? resolveClaudeImageMarkerPane(useAppStore.getState(), paneKey) : null
  }
  const openPreview = (pasteId: number): void => {
    // Resolve on click: the session may have changed since the link was hovered.
    const pane = resolvePane()
    if (pane) {
      useTerminalImagePreviewStore
        .getState()
        .openTerminalImagePreview({ ...pane, pasteId, canReadTranscript: !deps.isRuntimeOwned() })
    }
  }
  return {
    provideLinks: (bufferLineNumber, callback) => {
      const terminal = deps.getTerminal()
      const logicalLine = terminal
        ? buildWrappedLogicalLine(terminal.buffer.active, bufferLineNumber)
        : null
      if (!terminal || !logicalLine?.text.includes(MARKER_PREFIX) || !resolvePane()) {
        callback(undefined)
        return
      }
      const links = extractClaudeImageMarkers(logicalLine.text)
        .map((marker): ILink | null => {
          const range = rangeForParsedFileLink(logicalLine, marker.startIndex, marker.endIndex)
          if (!range) {
            return null
          }
          return {
            range,
            text: marker.text,
            activate: (event) => {
              let handled = false
              if (isTerminalLinkDirectActivation(event)) {
                event?.preventDefault()
                openPreview(marker.pasteId)
                handled = true
              } else if (isTerminalLinkActionActivation(event)) {
                handled = requestTerminalLinkAction(event, deps.getLinkActionContext?.(), {
                  destination: marker.text,
                  kind: 'image',
                  primary: {
                    label: translate(
                      'components.terminalPane.imagePreview.previewAction',
                      'Preview image'
                    ),
                    run: () => openPreview(marker.pasteId)
                  }
                })
              }
              if (handled) {
                terminal.clearSelection()
              }
            },
            hover: () => {
              const showActions = deps.getLinkActionContext?.() != null
              deps.linkTooltip.textContent = `${marker.text} (${previewHint(showActions)})`
              deps.linkTooltip.style.display = ''
            },
            leave: () => {
              deps.linkTooltip.style.display = 'none'
            }
          }
        })
        .filter((link): link is ILink => link !== null)
      callback(links.length > 0 ? links : undefined)
    }
  }
}
