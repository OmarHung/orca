import { readFile, stat } from 'node:fs/promises'
import { MAX_PROFILE_FILE_BYTES } from './ovpn-profile-preparation'

/**
 * Reads an .ovpn or a file it references. Checked before reading because profile paths are
 * user-authored: a device (/dev/zero), a FIFO or a huge file must not stall or flood main, and a
 * Windows UNC path must not start an SMB login.
 */
export async function readOvpnProfileFile(filePath: string): Promise<Buffer> {
  if (process.platform === 'win32' && /^(\\\\|\/\/)/.test(filePath)) {
    throw new Error('network paths are not supported')
  }
  const stats = await stat(filePath)
  if (!stats.isFile()) {
    throw new Error('not a regular file')
  }
  if (stats.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error('larger than 1 MB')
  }
  return readFile(filePath)
}
