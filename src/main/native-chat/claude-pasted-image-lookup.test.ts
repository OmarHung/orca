import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findClaudePastedImage,
  parseClaudeImagePrompt,
  parseClaudePastedImageLookupArgs,
  scanClaudeImagePrompts
} from './claude-pasted-image-lookup'

// Shape of a Claude Code 2.1.289 prompt row: `imagePasteIds` lists the `N` of each
// `[Image #N]` chip, aligned with the base64 image blocks in content order.
function promptRow(
  pasteIds: number[],
  images: { mediaType: string; data: string }[],
  timestamp = '2026-10-05T10:00:00.000Z'
): string {
  return JSON.stringify({
    type: 'user',
    uuid: `prompt-${pasteIds.join('-')}`,
    promptId: `p-${pasteIds.join('-')}`,
    timestamp,
    imagePasteIds: pasteIds,
    message: {
      role: 'user',
      content: [
        { type: 'text', text: pasteIds.map((id) => `[Image #${id}]`).join(' ') },
        ...images.map(({ mediaType, data }) => ({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data }
        }))
      ]
    }
  })
}

async function* linesOf(rows: string[]): AsyncGenerator<{ line: string }> {
  for (const line of rows) {
    yield { line }
  }
}

const PNG_A = { mediaType: 'image/png', data: 'QUFBQQ==' }
const JPEG_B = { mediaType: 'image/jpeg', data: 'QkJCQg==' }

describe('parseClaudeImagePrompt', () => {
  it('reads paste ids, image blocks and timestamp from an image prompt row', () => {
    expect(parseClaudeImagePrompt(promptRow([2, 3], [PNG_A, JPEG_B]))).toEqual({
      pasteIds: [2, 3],
      images: [PNG_A, JPEG_B],
      timestamp: '2026-10-05T10:00:00.000Z'
    })
  })

  it('ignores rows without image paste ids, meta companions and malformed lines', () => {
    expect(parseClaudeImagePrompt(JSON.stringify({ type: 'user', message: {} }))).toBeNull()
    expect(
      parseClaudeImagePrompt(
        JSON.stringify({ type: 'user', isMeta: true, imagePasteIds: [1], message: { content: [] } })
      )
    ).toBeNull()
    expect(parseClaudeImagePrompt('{"imagePasteIds": [1')).toBeNull()
    expect(
      parseClaudeImagePrompt(JSON.stringify({ type: 'user', imagePasteIds: ['1'], message: {} }))
    ).toBeNull()
  })
})

describe('scanClaudeImagePrompts', () => {
  it('returns the image aligned with the requested paste id', async () => {
    const result = await scanClaudeImagePrompts(
      linesOf([promptRow([1], [PNG_A]), promptRow([2, 3], [PNG_A, JPEG_B])]),
      3
    )
    expect(result).toEqual({ status: 'found', ...JPEG_B })
  })

  it('prefers the latest prompt when an id repeats', async () => {
    const result = await scanClaudeImagePrompts(
      linesOf([promptRow([1], [PNG_A]), promptRow([1], [JPEG_B])]),
      1
    )
    expect(result).toEqual({ status: 'found', ...JPEG_B })
  })

  it('never guesses when ids and image blocks do not line up', async () => {
    const result = await scanClaudeImagePrompts(
      linesOf([promptRow([4, 5], [PNG_A], '2026-10-05T11:00:00.000Z')]),
      4
    )
    expect(result).toEqual({
      status: 'missing',
      highestPasteId: 5,
      lastImagePromptAt: '2026-10-05T11:00:00.000Z'
    })
  })

  it('reports the highest submitted id for an unsubmitted marker', async () => {
    const result = await scanClaudeImagePrompts(
      linesOf([
        promptRow([1], [PNG_A], '2026-10-05T10:00:00.000Z'),
        JSON.stringify({ type: 'assistant', message: { content: [] } }),
        promptRow([2], [JPEG_B], '2026-10-05T10:05:00.000Z')
      ]),
      3
    )
    expect(result).toEqual({
      status: 'missing',
      highestPasteId: 2,
      lastImagePromptAt: '2026-10-05T10:05:00.000Z'
    })
  })
})

describe('parseClaudePastedImageLookupArgs', () => {
  it('accepts a well-formed request and drops an empty transcript path', () => {
    expect(
      parseClaudePastedImageLookupArgs({
        agent: 'claude',
        sessionId: 's',
        transcriptPath: '',
        pasteId: 2
      })
    ).toEqual({ agent: 'claude', sessionId: 's', pasteId: 2 })
  })

  it('rejects malformed renderer input', () => {
    expect(parseClaudePastedImageLookupArgs(null)).toBeNull()
    expect(
      parseClaudePastedImageLookupArgs({ agent: 'claude', sessionId: '', pasteId: 1 })
    ).toBeNull()
    expect(
      parseClaudePastedImageLookupArgs({ agent: 'claude', sessionId: 's', pasteId: 1.5 })
    ).toBeNull()
    expect(
      parseClaudePastedImageLookupArgs({
        agent: 'claude',
        sessionId: 's',
        pasteId: 1,
        transcriptPath: 7
      })
    ).toBeNull()
  })
})

describe('findClaudePastedImage', () => {
  let root: string | null = null

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true })
      root = null
    }
  })

  it('reads the hook-reported transcript file', async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-claude-pasted-image-'))
    const transcriptPath = join(root, 'session.jsonl')
    await writeFile(transcriptPath, `${promptRow([1], [PNG_A])}\n`)

    await expect(
      findClaudePastedImage({ agent: 'claude', sessionId: 'session', transcriptPath, pasteId: 1 })
    ).resolves.toEqual({ status: 'found', ...PNG_A })
  })

  it('treats a transcript that does not exist yet as nothing submitted', async () => {
    root = await mkdtemp(join(tmpdir(), 'orca-claude-pasted-image-'))
    await expect(
      findClaudePastedImage({
        agent: 'claude',
        sessionId: 'no-such-session-for-orca-test',
        transcriptPath: join(root, 'missing.jsonl'),
        pasteId: 1
      })
    ).resolves.toEqual({ status: 'missing', highestPasteId: 0, lastImagePromptAt: null })
  })

  it('refuses agents whose transcripts do not carry Claude image ids', async () => {
    await expect(
      findClaudePastedImage({ agent: 'codex', sessionId: 'session', pasteId: 1 })
    ).resolves.toMatchObject({ status: 'unavailable' })
  })
})
