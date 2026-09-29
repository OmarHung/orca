import { net } from 'electron'
import {
  FetchResponseBodyTooLargeError,
  readFetchResponseBytesWithinLimit
} from '../../../shared/fetch-response-body'

const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

export async function downloadWithElectronNet(url: string): Promise<Buffer> {
  // Why electron net: it honors the system proxy, which plain Node fetch does not.
  const response = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  }
  try {
    // Why streamed: the limit must stop an oversized body before it is all in memory.
    return Buffer.from(await readFetchResponseBytesWithinLimit(response, MAX_DOWNLOAD_BYTES))
  } catch (error) {
    if (error instanceof FetchResponseBodyTooLargeError) {
      throw new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes: ${url}`)
    }
    throw error
  }
}
