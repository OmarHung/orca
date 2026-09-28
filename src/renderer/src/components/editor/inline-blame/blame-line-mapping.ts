import type { ChangeMarkerHunk } from '../change-markers/change-marker-hunks'

/**
 * The blamed file's line for a buffer line, given the hunks from the blamed
 * text to the buffer; null when the buffer line was added or edited since.
 */
export function mapBufferLineToBlamedLine(
  hunks: readonly ChangeMarkerHunk[],
  bufferLine: number
): number | null {
  let offset = 0
  for (const hunk of hunks) {
    if (bufferLine < hunk.startLine) {
      break
    }
    if (bufferLine <= hunk.endLine) {
      return null
    }
    offset += hunk.originalLines.length - (hunk.endLine - hunk.startLine + 1)
  }
  return bufferLine + offset
}
