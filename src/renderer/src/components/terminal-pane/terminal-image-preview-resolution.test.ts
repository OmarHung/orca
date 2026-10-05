import { describe, expect, it, vi } from 'vitest'
import type { ClaudePastedImageLookupResult } from '../../../../shared/claude-pasted-image'
import type { TerminalImagePreviewRequest } from '@/store/terminal-image-preview'
import type { TerminalImagePaste } from './terminal-image-paste-history'
import {
  inferUnsubmittedPaste,
  resolveTerminalImagePreview,
  unsubmittedPasteCandidates
} from './terminal-image-preview-resolution'

const PROMPT_AT = '2026-10-05T10:00:00.000Z'
const PROMPT_MS = Date.parse(PROMPT_AT)
// A 1x1 PNG, small enough for the raster preview limits.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function paste(
  path: string,
  offsetMs: number,
  sessionId: string | null = 's1'
): TerminalImagePaste {
  return { path, connectionId: null, pastedAt: PROMPT_MS + offsetMs, sessionId }
}

function request(
  overrides: Partial<TerminalImagePreviewRequest> = {}
): TerminalImagePreviewRequest {
  return {
    pasteId: 3,
    paneKey: 'tab:leaf',
    agent: 'claude',
    sessionId: 's1',
    transcriptPath: '/t/s1.jsonl',
    canReadTranscript: true,
    ...overrides
  }
}

function deps(lookup: ClaudePastedImageLookupResult, pastes: TerminalImagePaste[] = []) {
  return {
    findClaudePastedImage: vi.fn().mockResolvedValue(lookup),
    listPastes: () => pastes
  }
}

describe('unsubmittedPasteCandidates', () => {
  it('keeps this session’s pastes made after the last image prompt', () => {
    const before = paste('/before.png', -1)
    const after = paste('/after.png', 1)
    const otherSession = paste('/other.png', 2, 's0')
    const unknownSession = paste('/unknown.png', 3, null)

    expect(
      unsubmittedPasteCandidates({
        pastes: [before, after, otherSession, unknownSession],
        sessionId: 's1',
        lastImagePromptAt: PROMPT_AT
      })
    ).toEqual([after, unknownSession])
  })
})

describe('inferUnsubmittedPaste', () => {
  it('maps consecutive chip numbers onto pastes after the highest submitted id', () => {
    const a = paste('/a.png', 1)
    const b = paste('/b.png', 2)
    expect(inferUnsubmittedPaste([a, b], 3, 2)).toBe(a)
    expect(inferUnsubmittedPaste([a, b], 4, 2)).toBe(b)
    expect(inferUnsubmittedPaste([a, b], 5, 2)).toBeNull()
    expect(inferUnsubmittedPaste([a, b], 2, 2)).toBeNull()
  })
})

describe('resolveTerminalImagePreview', () => {
  it('shows a submitted image straight from the transcript', async () => {
    const resolution = await resolveTerminalImagePreview(
      request(),
      deps({ status: 'found', mediaType: 'image/png', data: PNG_BASE64 })
    )
    expect(resolution).toEqual({ kind: 'submitted', src: `data:image/png;base64,${PNG_BASE64}` })
  })

  it('matches an unsent chip to the paste that produced it', async () => {
    const a = paste('/a.png', 1)
    const b = paste('/b.png', 2)
    const resolution = await resolveTerminalImagePreview(
      request({ pasteId: 4 }),
      deps({ status: 'missing', highestPasteId: 2, lastImagePromptAt: PROMPT_AT }, [
        paste('/old.png', -5),
        a,
        b
      ])
    )
    expect(resolution).toEqual({ kind: 'unsubmitted', paste: b, candidates: [a, b] })
  })

  it('lets the user pick when the numbering does not line up', async () => {
    const a = paste('/a.png', 1)
    const resolution = await resolveTerminalImagePreview(
      request({ pasteId: 5 }),
      deps({ status: 'missing', highestPasteId: 2, lastImagePromptAt: PROMPT_AT }, [a])
    )
    expect(resolution).toEqual({ kind: 'unresolved', candidates: [a], detail: null })
  })

  it('never guesses when the transcript cannot be read', async () => {
    const a = paste('/a.png', 1)
    const resolution = await resolveTerminalImagePreview(
      request({ pasteId: 1 }),
      deps({ status: 'unavailable', message: 'Transcript is on a stalled WSL distro.' }, [a])
    )
    expect(resolution).toEqual({
      kind: 'unresolved',
      candidates: [a],
      detail: 'Transcript is on a stalled WSL distro.'
    })
  })

  it('counts from the first paste for panes whose transcript lives elsewhere', async () => {
    const a = paste('/a.png', 1)
    const b = paste('/b.png', 2)
    const lookup = deps({ status: 'found', mediaType: 'image/png', data: PNG_BASE64 }, [a, b])
    const resolution = await resolveTerminalImagePreview(
      request({ pasteId: 2, canReadTranscript: false }),
      lookup
    )
    expect(lookup.findClaudePastedImage).not.toHaveBeenCalled()
    expect(resolution).toEqual({ kind: 'unsubmitted', paste: b, candidates: [a, b] })
  })

  it('surfaces a failed lookup instead of guessing', async () => {
    const a = paste('/a.png', 1)
    const resolution = await resolveTerminalImagePreview(request({ pasteId: 1 }), {
      findClaudePastedImage: vi.fn().mockRejectedValue(new Error('IPC closed')),
      listPastes: () => [a]
    })
    expect(resolution).toEqual({ kind: 'unresolved', candidates: [a], detail: 'IPC closed' })
  })
})
