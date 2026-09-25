import { z } from 'zod'
import { FORK_SYNC_STAGES } from '../../shared/fork-sync-status'

/** Prefix the sync script puts on machine-readable lines in `--events` mode. */
export const FORK_SYNC_EVENT_PREFIX = 'ORCA_SYNC_EVENT '
/** Exit code the sync script uses when a rebase conflict was reported and aborted. */
export const FORK_SYNC_CONFLICT_EXIT_CODE = 2

const forkSyncEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stage'), stage: z.enum(FORK_SYNC_STAGES) }),
  z.object({
    type: z.literal('conflict'),
    worktree: z.string().min(1),
    baseTag: z.string().min(1),
    files: z.array(z.string()).max(500),
    commitSubject: z.string().nullable()
  }),
  z.object({ type: z.literal('done'), manifestPath: z.string().min(1) })
])

export type ForkSyncEvent = z.infer<typeof forkSyncEventSchema>

/** Parses one output line; null for ordinary log output or a malformed event. */
export function parseForkSyncEventLine(line: string): ForkSyncEvent | null {
  if (!line.startsWith(FORK_SYNC_EVENT_PREFIX)) {
    return null
  }
  try {
    const parsed = forkSyncEventSchema.safeParse(
      JSON.parse(line.slice(FORK_SYNC_EVENT_PREFIX.length))
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Keeps the last `limit` lines of combined output for failure reports. */
export class OutputTail {
  private readonly lines: string[] = []

  constructor(private readonly limit: number) {}

  push(line: string): void {
    this.lines.push(line)
    if (this.lines.length > this.limit) {
      this.lines.shift()
    }
  }

  toString(): string {
    return this.lines.join('\n')
  }
}
