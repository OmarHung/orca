import { resolveNativeChatTranscriptAgent } from '../../shared/native-chat-agent-support'
import {
  isClaudePasteId,
  type ClaudePastedImageLookupArgs,
  type ClaudePastedImageLookupResult
} from '../../shared/claude-pasted-image'
import { errorMessage } from '../ai-vault/session-scanner-values'
import { resolveSessionFilePath } from './session-file-resolver'
import { openTranscriptReadStream } from './wsl-transcript-fs-access'
import { wslTranscriptFsRefusal } from './wsl-transcript-fs-gate'
import { splitTranscriptStreamLines } from './transcript-stream-lines'

type PastedImage = { mediaType: string; data: string }

export type ClaudeImagePrompt = {
  pasteIds: number[]
  /** Base64 image blocks in content order; aligned with `pasteIds`. */
  images: PastedImage[]
  timestamp: string | null
}

// Why: prompt rows with images carry megabytes of base64; skip JSON.parse for
// every other row with a cheap substring check first.
const IMAGE_PASTE_IDS_KEY = '"imagePasteIds"'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function base64ImageOf(block: unknown): PastedImage | null {
  if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) {
    return null
  }
  const { type, media_type: mediaType, data } = block.source
  if (type !== 'base64' || typeof mediaType !== 'string' || typeof data !== 'string') {
    return null
  }
  return { mediaType, data }
}

/** Parses a Claude Code prompt row that carries pasted images, else null.
 *  Claude records `imagePasteIds` (the `N`s of its `[Image #N]` chips) next to
 *  one base64 image block per id, in the same order. */
export function parseClaudeImagePrompt(line: string): ClaudeImagePrompt | null {
  if (!line.includes(IMAGE_PASTE_IDS_KEY)) {
    return null
  }
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(record) || record.type !== 'user' || record.isMeta === true) {
    return null
  }
  const { imagePasteIds } = record
  if (!Array.isArray(imagePasteIds) || !imagePasteIds.every(isClaudePasteId)) {
    return null
  }
  const content = isRecord(record.message) ? record.message.content : undefined
  const images = Array.isArray(content)
    ? content.map(base64ImageOf).filter((image): image is PastedImage => image !== null)
    : []
  return {
    pasteIds: imagePasteIds,
    images,
    timestamp: typeof record.timestamp === 'string' ? record.timestamp : null
  }
}

/** Finds the latest submitted image for `pasteId` in a stream of transcript lines. */
export async function scanClaudeImagePrompts(
  lines: AsyncIterable<{ line: string }>,
  pasteId: number
): Promise<ClaudePastedImageLookupResult> {
  let found: PastedImage | null = null
  let highestPasteId = 0
  let lastImagePromptAt: string | null = null
  for await (const { line } of lines) {
    const prompt = parseClaudeImagePrompt(line)
    if (!prompt) {
      continue
    }
    highestPasteId = Math.max(highestPasteId, ...prompt.pasteIds)
    lastImagePromptAt = prompt.timestamp ?? lastImagePromptAt
    const index = prompt.pasteIds.indexOf(pasteId)
    // A count mismatch means the id-to-block alignment is unproven; never guess.
    if (index !== -1 && prompt.images.length === prompt.pasteIds.length) {
      found = prompt.images[index] ?? null
    }
  }
  return found
    ? { status: 'found', ...found }
    : { status: 'missing', highestPasteId, lastImagePromptAt }
}

/** Validates renderer-supplied lookup args at the IPC boundary. */
export function parseClaudePastedImageLookupArgs(
  value: unknown
): ClaudePastedImageLookupArgs | null {
  if (!isRecord(value)) {
    return null
  }
  const { agent, sessionId, transcriptPath, pasteId } = value
  if (
    typeof agent !== 'string' ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    (transcriptPath !== undefined && typeof transcriptPath !== 'string') ||
    !isClaudePasteId(pasteId)
  ) {
    return null
  }
  return { agent, sessionId, pasteId, ...(transcriptPath ? { transcriptPath } : {}) }
}

const NO_SUBMITTED_IMAGES: ClaudePastedImageLookupResult = {
  status: 'missing',
  highestPasteId: 0,
  lastImagePromptAt: null
}

export async function findClaudePastedImage(
  args: ClaudePastedImageLookupArgs
): Promise<ClaudePastedImageLookupResult> {
  if (resolveNativeChatTranscriptAgent(args.agent) !== 'claude' || !isClaudePasteId(args.pasteId)) {
    return { status: 'unavailable', message: 'Only Claude Code image markers can be previewed.' }
  }
  let filePath: string | null
  try {
    filePath = await resolveSessionFilePath(args.agent, args.sessionId, {
      transcriptPath: args.transcriptPath
    })
  } catch (error) {
    return { status: 'unavailable', message: wslTranscriptFsRefusal(error).message }
  }
  if (!filePath) {
    // Claude writes the transcript on first submit, so nothing is submitted yet.
    return NO_SUBMITTED_IMAGES
  }
  try {
    const stream = openTranscriptReadStream(filePath, { encoding: 'utf-8' }, 'exact')
    return await scanClaudeImagePrompts(splitTranscriptStreamLines(stream), args.pasteId)
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') {
      return NO_SUBMITTED_IMAGES
    }
    return { status: 'unavailable', message: errorMessage(error) }
  }
}
