import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FileEntryWithStats, Stats, TransferOptions } from 'ssh2'
import type { SftpOps } from './sftp-ops'

type FakeNode =
  | { kind: 'dir' }
  | { kind: 'file'; content: Buffer }
  | { kind: 'link'; target: string }

const MTIME_SECONDS = 1_700_000_000

function statsFor(node: FakeNode): Stats {
  const kind = node.kind
  const size = node.kind === 'file' ? node.content.length : 0
  return {
    mode: kind === 'dir' ? 0o040755 : kind === 'link' ? 0o120777 : 0o100644,
    uid: 1000,
    gid: 1000,
    size,
    atime: MTIME_SECONDS,
    mtime: MTIME_SECONDS,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
    isSymbolicLink: () => kind === 'link',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false
  }
}

function noSuchFile(target: string): Error {
  return Object.assign(new Error(`No such file: ${target}`), { code: 2 })
}

/** In-memory remote filesystem implementing the SFTP calls the page uses. */
export class FakeSftp implements SftpOps {
  ended = false

  /** Channels opened from one fake share its files but end independently. */
  constructor(readonly nodes = new Map<string, FakeNode>([['/', { kind: 'dir' }]])) {}

  openChannel(): FakeSftp {
    return new FakeSftp(this.nodes)
  }
  /** Called before each fastGet/fastPut so a test can end the channel mid-transfer. */
  beforeTransfer: (() => void) | null = null

  addDir(dir: string): this {
    this.nodes.set(dir, { kind: 'dir' })
    return this
  }

  addFile(file: string, content: string): this {
    this.nodes.set(file, { kind: 'file', content: Buffer.from(content) })
    return this
  }

  addLink(link: string, target: string): this {
    this.nodes.set(link, { kind: 'link', target })
    return this
  }

  readText(file: string): string | null {
    const node = this.nodes.get(file)
    return node?.kind === 'file' ? node.content.toString() : null
  }

  private resolve(target: string): FakeNode | undefined {
    const node = this.nodes.get(target)
    return node?.kind === 'link' ? this.nodes.get(node.target) : node
  }

  readdir(
    dir: string,
    callback: (err: Error | undefined, list: FileEntryWithStats[]) => void
  ): void {
    if (this.nodes.get(dir)?.kind !== 'dir') {
      callback(noSuchFile(dir), [])
      return
    }
    const list = [...this.nodes.entries()]
      .filter(([entry]) => entry !== dir && path.posix.dirname(entry) === dir)
      .map(([entry, node]) => ({
        filename: path.posix.basename(entry),
        longname: path.posix.basename(entry),
        attrs: statsFor(node)
      }))
    callback(undefined, list)
  }

  stat(target: string, callback: (err: Error | undefined, stats: Stats) => void): void {
    const node = this.resolve(target)
    if (node) {
      callback(undefined, statsFor(node))
    } else {
      callback(noSuchFile(target), statsFor({ kind: 'dir' }))
    }
  }

  lstat(target: string, callback: (err: Error | undefined, stats: Stats) => void): void {
    const node = this.nodes.get(target)
    if (node) {
      callback(undefined, statsFor(node))
    } else {
      callback(noSuchFile(target), statsFor({ kind: 'dir' }))
    }
  }

  realpath(target: string, callback: (err: Error | undefined, absPath: string) => void): void {
    callback(undefined, target === '.' ? '/home/dev' : target)
  }

  mkdir(dir: string, callback: (err?: Error | null) => void): void {
    if (this.nodes.has(dir)) {
      callback(Object.assign(new Error('Failure'), { code: 4 }))
      return
    }
    this.nodes.set(dir, { kind: 'dir' })
    callback()
  }

  rmdir(dir: string, callback: (err?: Error | null) => void): void {
    this.nodes.delete(dir)
    callback()
  }

  unlink(file: string, callback: (err?: Error | null) => void): void {
    this.nodes.delete(file)
    callback()
  }

  rename(from: string, to: string, callback: (err?: Error | null) => void): void {
    // Why: snapshot first; the loop re-keys entries, and a live Map iterator would visit them again.
    for (const [entry, node] of Array.from(this.nodes.entries())) {
      if (entry === from || entry.startsWith(`${from}/`)) {
        this.nodes.delete(entry)
        this.nodes.set(to + entry.slice(from.length), node)
      }
    }
    callback()
  }

  fastGet(
    remote: string,
    local: string,
    options: TransferOptions,
    callback: (err?: Error | null) => void
  ): void {
    this.beforeTransfer?.()
    const node = this.resolve(remote)
    if (this.ended || node?.kind !== 'file') {
      callback(this.ended ? new Error('Channel ended') : noSuchFile(remote))
      return
    }
    writeFileSync(local, node.content)
    options.step?.(node.content.length, node.content.length, node.content.length)
    callback()
  }

  fastPut(
    local: string,
    remote: string,
    options: TransferOptions,
    callback: (err?: Error | null) => void
  ): void {
    this.beforeTransfer?.()
    if (this.ended) {
      callback(new Error('Channel ended'))
      return
    }
    const content = readFileSync(local)
    this.nodes.set(remote, { kind: 'file', content })
    options.step?.(content.length, content.length, content.length)
    callback()
  }

  end(): void {
    this.ended = true
  }
}
