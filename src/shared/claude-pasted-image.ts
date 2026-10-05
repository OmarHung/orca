import type { AgentType } from './native-chat-types'

/** Matches the `[Image #N]` chip Claude Code paints for a pasted image. */
export const CLAUDE_IMAGE_MARKER_PATTERN = /\[Image #(\d+)\]/g

export type ClaudePastedImageLookupArgs = {
  agent: AgentType
  sessionId: string
  /** Hook-reported transcript path, preferred over the session-id glob. */
  transcriptPath?: string
  /** The `N` of `[Image #N]`. */
  pasteId: number
}

export type ClaudePastedImageLookupResult =
  | { status: 'found'; mediaType: string; data: string }
  | {
      status: 'missing'
      /** Largest paste id any submitted prompt carries; 0 when none. */
      highestPasteId: number
      /** When the last image-bearing prompt was submitted (ISO), if any. */
      lastImagePromptAt: string | null
    }
  | { status: 'unavailable'; message: string }

export function isClaudePasteId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
