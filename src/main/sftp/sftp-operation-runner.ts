import path from 'node:path'
import type { SftpLocalRoot, SftpOperation } from '../../shared/sftp-types'
import {
  openSftpLocalWriter,
  type SftpLocalWriter,
  type SpawnSftpLocalWriter
} from './local-writer/sftp-local-writer'
import {
  isSftpFailureStatus,
  sftpMkdir,
  sftpRename,
  sftpRmdir,
  sftpStat,
  sftpUnlink,
  type SftpOps
} from './sftp-ops'
import { downloadPlannedFile } from './sftp-planned-download'
import { uploadPlannedFile } from './sftp-planned-upload'

export type OperationProgress = { transferredBytes: number; currentFile: string | null }

export type SftpRunOptions = {
  /** Required for plans that write locally (downloads). */
  localRoot?: SftpLocalRoot
  spawnLocalWriter?: SpawnSftpLocalWriter
}

async function remoteMkdir(sftp: SftpOps, dir: string, keepExisting: boolean): Promise<void> {
  try {
    await sftpMkdir(sftp, dir)
  } catch (err) {
    // Why: SSH_FX_FAILURE is how OpenSSH says "exists"; only a folder may be merged into.
    const isFolder =
      keepExisting && isSftpFailureStatus(err)
        ? await sftpStat(sftp, dir).then(
            (stats) => stats.isDirectory(),
            () => false
          )
        : false
    if (!isFolder) {
      throw err
    }
  }
}

/** Names from the confirmed folder down to `target`; anything outside it is refused. */
function segmentsBelow(root: SftpLocalRoot, target: string): string[] {
  const relative = path.relative(root.path, target)
  const segments = relative.split(path.sep)
  if (
    relative === '' ||
    path.isAbsolute(relative) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`"${target}" is outside the folder this download was confirmed into.`)
  }
  return segments
}

/** Starts the local writer on the first local step, so remote-only plans never spawn it. */
class LocalWrites {
  private writer: Promise<SftpLocalWriter> | null = null

  constructor(private readonly options: SftpRunOptions) {}

  async open(target: string): Promise<{ writer: SftpLocalWriter; segments: string[] }> {
    const root = this.options.localRoot
    if (!root) {
      throw new Error('This plan has no confirmed local folder to write into.')
    }
    const segments = segmentsBelow(root, target)
    this.writer ??= openSftpLocalWriter(root, this.options.spawnLocalWriter)
    return { writer: await this.writer, segments }
  }

  async close(): Promise<void> {
    const writer = await this.writer?.catch(() => null)
    await writer?.close()
  }
}

/** Runs a confirmed plan exactly as listed, stopping at the first failure. */
export async function runSftpOperations(
  sftp: SftpOps,
  operations: readonly SftpOperation[],
  onProgress: (progress: OperationProgress) => void,
  options: SftpRunOptions = {}
): Promise<void> {
  const local = new LocalWrites(options)
  let completed = 0
  try {
    for (const operation of operations) {
      switch (operation.op) {
        case 'mkdir':
          await remoteMkdir(sftp, operation.path, operation.keepExisting)
          break
        case 'lmkdir': {
          const { writer, segments } = await local.open(operation.path)
          await writer.mkdir(segments)
          break
        }
        case 'put':
        case 'get': {
          const current = operation.op === 'put' ? operation.remote : operation.local
          const onStep = (transferred: number): void =>
            onProgress({ transferredBytes: completed + transferred, currentFile: current })
          onProgress({ transferredBytes: completed, currentFile: current })
          if (operation.op === 'put') {
            await uploadPlannedFile(sftp, operation, onStep)
          } else {
            const { writer, segments } = await local.open(operation.local)
            await downloadPlannedFile(sftp, operation.remote, writer, segments, onStep)
          }
          completed += operation.size
          break
        }
        case 'rename':
          await sftpRename(sftp, operation.from, operation.to)
          break
        case 'rm':
          await sftpUnlink(sftp, operation.path)
          break
        case 'rmdir':
          await sftpRmdir(sftp, operation.path)
          break
      }
    }
  } finally {
    await local.close()
  }
  onProgress({ transferredBytes: completed, currentFile: null })
}
