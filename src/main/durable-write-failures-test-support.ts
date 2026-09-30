import type * as SecureFile from '../shared/secure-file'

/**
 * What the next durable write to a path does: `throw-after` replaces the file and then throws, as a
 * failed ACL or directory fsync does; `throw-before` throws without writing; `ok` just writes.
 */
export type DurableWriteOutcome = 'ok' | 'throw-after' | 'throw-before'

const queued = new Map<string, DurableWriteOutcome[]>()

/** Queues how the next durable writes to `path` go, in order; later ones just write. */
export function queueDurableWrites(path: string, ...outcomes: DurableWriteOutcome[]): void {
  queued.set(path, outcomes)
}

export function clearDurableWrites(): void {
  queued.clear()
}

/** For vi.mock of shared/secure-file: the real module, with durable writes that go as queued. */
export function withQueuedDurableWrites(actual: typeof SecureFile): typeof SecureFile {
  return {
    ...actual,
    writeDurableSecureJsonFile: (targetPath, value) => {
      const outcome = queued.get(targetPath)?.shift() ?? 'ok'
      if (outcome === 'throw-before') {
        throw new Error('disk full')
      }
      const written = actual.writeDurableSecureJsonFile(targetPath, value)
      if (outcome === 'throw-after') {
        throw new Error('fsync failed')
      }
      return written
    }
  }
}
