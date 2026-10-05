import { create } from 'zustand'
import type { AgentType } from '../../../shared/agent-status-types'

export type TerminalImagePreviewRequest = {
  /** The `N` of the clicked `[Image #N]` chip. */
  pasteId: number
  paneKey: string
  agent: AgentType
  sessionId: string | null
  transcriptPath: string | null
  /** False for remote-runtime panes, whose transcript lives on the paired host. */
  canReadTranscript: boolean
}

type TerminalImagePreviewState = {
  request: TerminalImagePreviewRequest | null
  openTerminalImagePreview: (request: TerminalImagePreviewRequest) => void
  closeTerminalImagePreview: () => void
}

// Why standalone: the request is raised from an xterm link provider that only
// holds a pane, and only the app-level dialog reads it.
export const useTerminalImagePreviewStore = create<TerminalImagePreviewState>()((set) => ({
  request: null,
  openTerminalImagePreview: (request) => set({ request }),
  closeTerminalImagePreview: () => set({ request: null })
}))
