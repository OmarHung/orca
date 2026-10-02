import { lstat, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { SftpLocalRoot, SftpOperation, SftpPlanRequest } from '../../shared/sftp-types'
import { sftpLstat, sftpReaddir, sftpStat, type SftpOps } from './sftp-ops'
import { localFileIdentity } from './sftp-planned-upload'

export type SftpPlanDraft = {
  operations: SftpOperation[]
  totalBytes: number
  conflicts: string[]
  localRoot?: SftpLocalRoot
}

// Why: the whole list is sent to the confirm dialog; past this, ask for a smaller selection.
export const MAX_PLAN_OPERATIONS = 50_000

const remotePath = path.posix

class OperationList {
  readonly operations: SftpOperation[] = []
  totalBytes = 0

  add(operation: SftpOperation): void {
    if (this.operations.length >= MAX_PLAN_OPERATIONS) {
      throw new Error(
        `This selection needs more than ${MAX_PLAN_OPERATIONS.toLocaleString('en-US')} operations. Pick fewer items.`
      )
    }
    this.operations.push(operation)
    if (operation.op === 'put' || operation.op === 'get') {
      this.totalBytes += operation.size
    }
  }
}

// Why: remote names are joined onto a local folder; drop any that could climb out of it.
function isPlainName(name: string): boolean {
  return (
    name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes(path.sep)
  )
}

async function addLocalEntry(source: string, remote: string, list: OperationList): Promise<void> {
  // Why: lstat, never following links, so nothing outside what the user picked gets uploaded.
  const stats = await lstat(source, { bigint: true })
  if (stats.isDirectory()) {
    list.add({ op: 'mkdir', path: remote, keepExisting: true })
    for (const name of await readdir(source)) {
      await addLocalEntry(path.join(source, name), remotePath.join(remote, name), list)
    }
  } else if (stats.isFile()) {
    list.add({
      op: 'put',
      local: source,
      remote,
      size: Number(stats.size),
      source: localFileIdentity(stats)
    })
  }
}

async function addRemoteTree(
  sftp: SftpOps,
  dir: string,
  local: string,
  list: OperationList
): Promise<void> {
  list.add({ op: 'lmkdir', path: local })
  for (const entry of await sftpReaddir(sftp, dir)) {
    if (!isPlainName(entry.filename)) {
      continue
    }
    const source = remotePath.join(dir, entry.filename)
    const destination = path.join(local, entry.filename)
    if (entry.attrs.isDirectory()) {
      await addRemoteTree(sftp, source, destination, list)
      continue
    }
    // Why: follow links to files, but not to folders, so a link cycle cannot recurse forever.
    const stats = entry.attrs.isSymbolicLink()
      ? await sftpStat(sftp, source).catch(() => null)
      : entry.attrs
    if (stats?.isFile()) {
      list.add({ op: 'get', remote: source, local: destination, size: stats.size })
    }
  }
}

/** Deletes children before their folder. Links are removed, never followed into. */
async function addRemoteRemoval(sftp: SftpOps, target: string, list: OperationList): Promise<void> {
  const stats = await sftpLstat(sftp, target)
  if (!stats.isDirectory()) {
    list.add({ op: 'rm', path: target })
    return
  }
  for (const entry of await sftpReaddir(sftp, target)) {
    if (entry.filename !== '.' && entry.filename !== '..') {
      await addRemoteRemoval(sftp, remotePath.join(target, entry.filename), list)
    }
  }
  list.add({ op: 'rmdir', path: target })
}

async function remoteExists(sftp: SftpOps, target: string): Promise<boolean> {
  return sftpStat(sftp, target).then(
    () => true,
    () => false
  )
}

// Why: lstat, so a dangling link at the destination still counts as taken.
async function remoteEntryExists(sftp: SftpOps, target: string): Promise<boolean> {
  return sftpLstat(sftp, target).then(
    () => true,
    () => false
  )
}

async function localExists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false
  )
}

async function draftUpload(
  sftp: SftpOps,
  sources: readonly string[],
  remoteDir: string
): Promise<SftpPlanDraft> {
  const list = new OperationList()
  const conflicts: string[] = []
  for (const source of sources) {
    const name = path.basename(source)
    const destination = remotePath.join(remoteDir, name)
    if (await remoteExists(sftp, destination)) {
      conflicts.push(name)
    }
    await addLocalEntry(source, destination, list)
  }
  return { operations: list.operations, totalBytes: list.totalBytes, conflicts }
}

async function draftDownload(
  sftp: SftpOps,
  sources: readonly string[],
  localDir: string
): Promise<SftpPlanDraft> {
  // Why: the run writes only inside the folder this path means now, even if the path changes.
  const rootStats = await stat(localDir, { bigint: true })
  if (!rootStats.isDirectory()) {
    throw new Error(`"${localDir}" is not a folder.`)
  }
  const localRoot: SftpLocalRoot = { path: localDir, ...localFileIdentity(rootStats) }
  const list = new OperationList()
  const conflicts: string[] = []
  for (const source of sources) {
    const name = remotePath.basename(source)
    if (!isPlainName(name)) {
      continue
    }
    const destination = path.join(localDir, name)
    if (await localExists(destination)) {
      conflicts.push(name)
    }
    const stats = await sftpStat(sftp, source)
    if (stats.isDirectory()) {
      await addRemoteTree(sftp, source, destination, list)
    } else if (stats.isFile()) {
      list.add({ op: 'get', remote: source, local: destination, size: stats.size })
    }
  }
  return { operations: list.operations, totalBytes: list.totalBytes, conflicts, localRoot }
}

function normalizeRemote(target: string): string {
  const normalized = remotePath.normalize(target)
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized
}

/**
 * One rename per item. Items already in the folder are skipped; names taken there are reported
 * as conflicts because OpenSSH's rename never replaces an existing entry.
 */
async function draftMove(
  sftp: SftpOps,
  sources: readonly string[],
  destinationDir: string
): Promise<SftpPlanDraft> {
  const destination = normalizeRemote(destinationDir)
  const isFolder = await sftpStat(sftp, destination).then(
    (stats) => stats.isDirectory(),
    () => false
  )
  if (!isFolder) {
    throw new Error(`"${destination}" is not a folder.`)
  }
  const list = new OperationList()
  const conflicts: string[] = []
  for (const source of sources) {
    const from = normalizeRemote(source)
    const name = remotePath.basename(from)
    if (!isPlainName(name) || remotePath.dirname(from) === destination) {
      continue
    }
    if (destination === from || destination.startsWith(`${from}/`)) {
      throw new Error(`Cannot move "${name}" into itself.`)
    }
    const to = remotePath.join(destination, name)
    if (await remoteEntryExists(sftp, to)) {
      conflicts.push(name)
    }
    list.add({ op: 'rename', from, to })
  }
  return { operations: list.operations, totalBytes: 0, conflicts }
}

async function draftRemoval(sftp: SftpOps, paths: readonly string[]): Promise<SftpPlanDraft> {
  const list = new OperationList()
  for (const target of paths) {
    await addRemoteRemoval(sftp, target, list)
  }
  return { operations: list.operations, totalBytes: 0, conflicts: [] }
}

// Why walk up: a typed "a/b/c" also creates its missing parents, like `mkdir -p`.
async function draftMkdir(sftp: SftpOps, target: string): Promise<SftpPlanDraft> {
  const missingParents: string[] = []
  let dir = remotePath.dirname(target)
  while (dir !== '/' && !(await remoteExists(sftp, dir))) {
    missingParents.unshift(dir)
    dir = remotePath.dirname(dir)
  }
  return {
    operations: [
      ...missingParents.map((parent) => ({
        op: 'mkdir' as const,
        path: parent,
        keepExisting: true
      })),
      { op: 'mkdir', path: target, keepExisting: false }
    ],
    totalBytes: 0,
    conflicts: []
  }
}

/** Reads what the action would touch and lists every step it will run, in order. */
export async function draftSftpPlan(
  sftp: SftpOps,
  request: SftpPlanRequest
): Promise<SftpPlanDraft> {
  switch (request.kind) {
    case 'upload':
      return draftUpload(sftp, request.sources, request.destinationDir)
    case 'download':
      return draftDownload(sftp, request.sources, request.destinationDir)
    case 'remove':
      return draftRemoval(sftp, request.paths)
    case 'move':
      return draftMove(sftp, request.sources, request.destinationDir)
    case 'mkdir':
      return draftMkdir(sftp, request.path)
    case 'rename':
      return {
        operations: [{ op: 'rename', from: request.from, to: request.to }],
        totalBytes: 0,
        conflicts: (await remoteExists(sftp, request.to)) ? [remotePath.basename(request.to)] : []
      }
  }
}
