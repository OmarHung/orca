import { join } from 'node:path'
import { removeTree } from '../../../shared/windows-transient-lock-removal'
import { runProcess } from '../../../shared/child-process/run-process'
import { windowsSystem32Binary } from '../../../shared/child-process/windows-system-binary'
import { resolveCommandOnLocalPath } from '../../ipc/command-path-resolver'

const EXTRACT_TIMEOUT_MS = 120_000

async function tarProgram(): Promise<string> {
  if (process.platform === 'win32') {
    // Why System32 tar: Windows 10+ ships bsdtar there, and it also reads .zip files.
    return windowsSystem32Binary('tar.exe')
  }
  return (await resolveCommandOnLocalPath('tar')) ?? '/usr/bin/tar'
}

/**
 * Extracts a .tar.gz or .zip into `destination` with the system bsdtar, which refuses
 * absolute paths and `..` entries by default.
 */
export async function extractArchive(archivePath: string, destination: string): Promise<void> {
  const result = await runProcess({
    program: await tarProgram(),
    args: ['-xf', archivePath, '-C', destination],
    timeoutMs: EXTRACT_TIMEOUT_MS
  })
  if (result.code !== 0) {
    throw new Error(
      `Extracting ${archivePath} failed: ${result.stderr.trim() || `exit ${result.code}`}`
    )
  }
  // Why: macOS-built zips carry resource-fork metadata that is never needed.
  await removeTree(join(destination, '__MACOSX'))
}
