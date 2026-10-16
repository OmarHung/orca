import { isShellProcess } from '../../../../shared/shell-process-detection'
import {
  isClientOnlyUnverifiableInspection,
  type TerminalProcessInspection
} from '../../../../shared/terminal-process-inspection'

/** `ended`: the shell is back in front, so the restored run's command no longer runs. */
export type RestoredRunVerdict = 'ended' | 'running' | 'unknown'

const MAX_READS = 4
/** Why more than one: a compound command fronts the shell for a moment between its steps. */
const SHELL_READS_TO_END = 2
const READ_INTERVAL_MS = 2_000

function foregroundName(inspection: TerminalProcessInspection): string | null {
  if (isClientOnlyUnverifiableInspection(inspection)) {
    return null
  }
  const evidence = inspection.foregroundProcessEvidence
  if (evidence) {
    return evidence.verdict === 'live' ? evidence.processName : null
  }
  return inspection.foregroundProcess
}

/** An unobservable host is `unknown`, never `ended`: losing contact is not a process exit. */
export function restoredRunVerdict(inspection: TerminalProcessInspection): RestoredRunVerdict {
  const name = foregroundName(inspection)
  if (name === null) {
    return 'unknown'
  }
  return isShellProcess(name) ? 'ended' : 'running'
}

/** Reads the terminal a few times, since a shell still sourcing rc files can front a child. */
export async function verifyRestoredRun(
  inspect: () => Promise<TerminalProcessInspection>,
  wait: (ms: number) => Promise<void>
): Promise<RestoredRunVerdict> {
  let shellReads = 0
  for (let read = 0; read < MAX_READS; read += 1) {
    await wait(READ_INTERVAL_MS)
    let verdict: RestoredRunVerdict
    try {
      verdict = restoredRunVerdict(await inspect())
    } catch {
      return 'unknown'
    }
    if (verdict === 'unknown') {
      return 'unknown'
    }
    shellReads = verdict === 'ended' ? shellReads + 1 : 0
    if (shellReads >= SHELL_READS_TO_END) {
      return 'ended'
    }
  }
  return 'running'
}
