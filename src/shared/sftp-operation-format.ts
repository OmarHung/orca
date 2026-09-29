import type { SftpOperation } from './sftp-types'

// Why: JSON string quoting is unambiguous for spaces, quotes and newlines, and OpenSSH's sftp
// batch parser reads the same \" and \\ escapes.
function quote(value: string): string {
  return JSON.stringify(value)
}

/** One operation as an OpenSSH sftp batch line; a leading "-" means an error is tolerated. */
export function formatSftpOperation(operation: SftpOperation): string {
  switch (operation.op) {
    case 'mkdir':
      return `${operation.keepExisting ? '-' : ''}mkdir ${quote(operation.path)}`
    case 'lmkdir':
      return `-lmkdir ${quote(operation.path)}`
    case 'put':
      return `put ${quote(operation.local)} ${quote(operation.remote)}`
    case 'get':
      return `get ${quote(operation.remote)} ${quote(operation.local)}`
    case 'rename':
      return `rename ${quote(operation.from)} ${quote(operation.to)}`
    case 'rm':
      return `rm ${quote(operation.path)}`
    case 'rmdir':
      return `rmdir ${quote(operation.path)}`
  }
}

export type SftpOperationCounts = Record<SftpOperation['op'], number>

export function countSftpOperations(operations: readonly SftpOperation[]): SftpOperationCounts {
  const counts: SftpOperationCounts = {
    mkdir: 0,
    lmkdir: 0,
    put: 0,
    get: 0,
    rename: 0,
    rm: 0,
    rmdir: 0
  }
  for (const operation of operations) {
    counts[operation.op] += 1
  }
  return counts
}
