import type {
  ClaudePastedImageLookupArgs,
  ClaudePastedImageLookupResult
} from '../../../../shared/claude-pasted-image'
import { buildImageDataUri } from '../../../../shared/image-data-uri'
import type { TerminalImagePreviewRequest } from '@/store/terminal-image-preview'
import type { TerminalImagePaste } from './terminal-image-paste-history'

export type TerminalImagePreviewResolution =
  /** Read from the agent transcript, so it is exactly what the agent received. */
  | { kind: 'submitted'; src: string }
  /** Not sent yet; matched to a recorded paste by Claude's consecutive numbering. */
  | { kind: 'unsubmitted'; paste: TerminalImagePaste; candidates: readonly TerminalImagePaste[] }
  | { kind: 'unresolved'; candidates: readonly TerminalImagePaste[]; detail: string | null }

export type TerminalImagePreviewDeps = {
  findClaudePastedImage?: (
    args: ClaudePastedImageLookupArgs
  ) => Promise<ClaudePastedImageLookupResult>
  listPastes: (paneKey: string) => readonly TerminalImagePaste[]
}

/** Pastes made in this agent session since its last image-bearing prompt, oldest first. */
export function unsubmittedPasteCandidates(args: {
  pastes: readonly TerminalImagePaste[]
  sessionId: string | null
  lastImagePromptAt: string | null
}): TerminalImagePaste[] {
  const promptMs = args.lastImagePromptAt ? Date.parse(args.lastImagePromptAt) : Number.NaN
  return args.pastes.filter(
    (paste) =>
      (args.sessionId === null || paste.sessionId === null || paste.sessionId === args.sessionId) &&
      (Number.isNaN(promptMs) || paste.pastedAt > promptMs)
  )
}

/** Claude numbers chips consecutively, so the k-th paste after the highest
 *  submitted id became `#highest+k`. A paste Orca never saw (Claude's own
 *  Ctrl+V) breaks the count; the caller then lets the user pick. */
export function inferUnsubmittedPaste(
  candidates: readonly TerminalImagePaste[],
  pasteId: number,
  highestPasteId: number
): TerminalImagePaste | null {
  const index = pasteId - highestPasteId - 1
  return index >= 0 ? (candidates[index] ?? null) : null
}

const NOTHING_SUBMITTED: ClaudePastedImageLookupResult = {
  status: 'missing',
  highestPasteId: 0,
  lastImagePromptAt: null
}

async function lookUpSubmittedImage(
  request: TerminalImagePreviewRequest,
  deps: TerminalImagePreviewDeps
): Promise<ClaudePastedImageLookupResult> {
  if (!request.sessionId || !request.canReadTranscript || !deps.findClaudePastedImage) {
    return NOTHING_SUBMITTED
  }
  try {
    return await deps.findClaudePastedImage({
      agent: request.agent,
      sessionId: request.sessionId,
      pasteId: request.pasteId,
      ...(request.transcriptPath ? { transcriptPath: request.transcriptPath } : {})
    })
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function resolveTerminalImagePreview(
  request: TerminalImagePreviewRequest,
  deps: TerminalImagePreviewDeps
): Promise<TerminalImagePreviewResolution> {
  const lookup = await lookUpSubmittedImage(request, deps)
  const pastes = deps.listPastes(request.paneKey)
  if (lookup.status === 'found') {
    const src = buildImageDataUri(lookup.mediaType, lookup.data)
    if (src) {
      return { kind: 'submitted', src }
    }
    return { kind: 'unresolved', candidates: pastes, detail: null }
  }
  if (lookup.status === 'unavailable') {
    // Without the transcript the numbering baseline is unknown; never guess.
    return { kind: 'unresolved', candidates: pastes, detail: lookup.message }
  }
  const candidates = unsubmittedPasteCandidates({
    pastes,
    sessionId: request.sessionId,
    lastImagePromptAt: lookup.lastImagePromptAt
  })
  const paste = inferUnsubmittedPaste(candidates, request.pasteId, lookup.highestPasteId)
  return paste
    ? { kind: 'unsubmitted', paste, candidates }
    : { kind: 'unresolved', candidates: candidates.length > 0 ? candidates : pastes, detail: null }
}
