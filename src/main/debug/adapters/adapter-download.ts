import { net } from 'electron'

const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024

export async function downloadWithElectronNet(url: string): Promise<Buffer> {
  // Why electron net: it honors the system proxy, which plain Node fetch does not.
  const response = await net.fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes: ${url}`)
  }
  return bytes
}
