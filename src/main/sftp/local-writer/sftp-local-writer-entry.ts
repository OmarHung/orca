// Plain-Node child process (ELECTRON_RUN_AS_NODE). Only type imports from the app, so tests run
// this file directly with Node.
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  type BigIntStats
} from 'node:fs'
import type { SftpLocalFileIdentity } from '../../../shared/sftp-types'
import type { LocalWriterRequest, LocalWriterResponse } from './sftp-local-writer-protocol'

/*
 * Writes an SFTP download into the folder the user confirmed. This process is started with that
 * folder as its working directory, which refers to the folder itself rather than its path: once a
 * folder is checked and entered, renaming its path or putting a link there cannot redirect a write.
 * Node has no openat/renameat, so every step uses single names relative to a checked folder.
 */

type OpenFile = { fd: number; parent: string[]; name: string; partial: string }

const PARTIAL_PREFIX = '.orca-download-'
const REPLACED_MESSAGE =
  'A folder in this download was moved or replaced after the download was confirmed, so nothing more was written.'

let root: SftpLocalFileIdentity | null = null
/** Folders entered below the root, in order; the working directory is the last one. */
let here: string[] = []
let nextHandle = 1
const files = new Map<number, OpenFile>()

function identityOf(stats: BigIntStats): SftpLocalFileIdentity {
  return { dev: stats.dev.toString(), ino: stats.ino.toString() }
}

function isSame(a: SftpLocalFileIdentity, b: SftpLocalFileIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino
}

function currentIdentity(): SftpLocalFileIdentity {
  return identityOf(statSync('.', { bigint: true }))
}

function isPlainName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

function splitTarget(segments: string[]): { parent: string[]; name: string } {
  const name = segments.at(-1)
  if (name === undefined || !segments.every(isPlainName)) {
    throw new Error(`"${segments.join('/')}" is not inside the download folder.`)
  }
  return { parent: segments.slice(0, -1), name }
}

/** Makes `segments` (below the root) the working directory, checking every folder on the way. */
function goTo(segments: string[]): void {
  if (!root) {
    throw new Error('The download folder was never checked.')
  }
  for (let depth = here.length; depth > 0; depth -= 1) {
    process.chdir('..')
  }
  here = []
  // Why: '..' follows the folders we were in wherever they were moved, so land on the root or stop.
  if (!isSame(currentIdentity(), root)) {
    throw new Error(REPLACED_MESSAGE)
  }
  for (const segment of segments) {
    const checked = lstatSync(segment, { bigint: true })
    if (!checked.isDirectory()) {
      throw new Error(REPLACED_MESSAGE)
    }
    process.chdir(segment)
    here.push(segment)
    // Why: lstat and chdir are separate steps; confirm we entered the folder that was checked.
    if (!isSame(currentIdentity(), identityOf(checked))) {
      throw new Error(REPLACED_MESSAGE)
    }
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function makeFolder(segments: string[]): void {
  const { parent, name } = splitTarget(segments)
  goTo(parent)
  try {
    mkdirSync(name)
  } catch (error) {
    // Why lstat: only a real folder may be merged into, never a link to one.
    if (!hasErrorCode(error, 'EEXIST') || !lstatSync(name).isDirectory()) {
      throw error
    }
  }
}

function openFile(segments: string[]): number {
  const { parent, name } = splitTarget(segments)
  goTo(parent)
  const partial = `${PARTIAL_PREFIX}${randomBytes(8).toString('hex')}`
  // Why 'wx': O_EXCL refuses any existing entry at the name, a planted link included.
  const fd = openSync(partial, 'wx')
  const handle = nextHandle
  nextHandle += 1
  files.set(handle, { fd, parent, name, partial })
  return handle
}

function takeFile(handle: number): OpenFile {
  const file = files.get(handle)
  if (!file) {
    throw new Error('That download file is no longer open.')
  }
  return file
}

function writeChunk(handle: number, position: number, data: Uint8Array): void {
  const { fd } = takeFile(handle)
  let written = 0
  while (written < data.length) {
    written += writeSync(fd, data, written, data.length - written, position + written)
  }
}

function commitFile(handle: number): void {
  const file = takeFile(handle)
  files.delete(handle)
  closeSync(file.fd)
  goTo(file.parent)
  // Why rename: an existing file or link at the name is replaced as an entry, never written through.
  renameSync(file.partial, file.name)
}

function abortFile(handle: number): void {
  const file = files.get(handle)
  if (!file) {
    return
  }
  files.delete(handle)
  closeSync(file.fd)
  goTo(file.parent)
  unlinkSync(file.partial)
}

function run(request: LocalWriterRequest): number | undefined {
  switch (request.type) {
    case 'init':
      root = request.root
      here = []
      if (!isSame(currentIdentity(), request.root)) {
        root = null
        throw new Error(
          'The download folder was moved or replaced after the download was confirmed, so nothing was written.'
        )
      }
      return undefined
    case 'mkdir':
      makeFolder(request.segments)
      return undefined
    case 'open':
      return openFile(request.segments)
    case 'write':
      writeChunk(request.handle, request.position, request.data)
      return undefined
    case 'commit':
      commitFile(request.handle)
      return undefined
    case 'abort':
      abortFile(request.handle)
      return undefined
  }
}

function respond(request: LocalWriterRequest): LocalWriterResponse {
  try {
    const handle = run(request)
    return handle === undefined
      ? { id: request.id, ok: true }
      : { id: request.id, ok: true, handle }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

process.on('message', (request: LocalWriterRequest) => {
  process.send?.(respond(request))
})

// Why: main ends a download by disconnecting; any file still open was not completed.
process.on('disconnect', () => {
  for (const handle of Array.from(files.keys())) {
    try {
      abortFile(handle)
    } catch {
      // A folder that moved keeps its hidden partial file; nothing else was written.
    }
  }
  process.exit(0)
})
