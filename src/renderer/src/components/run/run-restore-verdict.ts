import { isShellProcess } from '../../../../shared/shell-process-detection'
import {
  isClientOnlyUnverifiableInspection,
  type TerminalProcessInspection
} from '../../../../shared/terminal-process-inspection'

/** `ended`: nothing runs in the pane any more, so the restored run's command is gone. */
export type RestoredRunVerdict = 'ended' | 'running' | 'unknown'

const MAX_READS = 4
/** Why more than one: a compound command fronts the shell for a moment between its steps. */
const IDLE_READS_TO_END = 2
const READ_INTERVAL_MS = 2_000

/**
 * Reads the host's own answer about the pane. The process name is null for an ordinary command
 * and for an idle shell, so only the ownership flag can tell "nothing runs here" from "something does".
 */
export function restoredRunVerdict(inspection: TerminalProcessInspection): RestoredRunVerdict {
  if (isClientOnlyUnverifiableInspection(inspection)) {
    return 'unknown'
  }
  const evidence = inspection.foregroundProcessEvidence
  if (evidence) {
    if (evidence.verdict !== 'live') {
      return 'unknown'
    }
    if (evidence.shellOwnsEveryTtyProcessGroup === true) {
      return 'ended'
    }
    return evidence.shellOwnsEveryTtyProcessGroup === false ? 'running' : 'unknown'
  }
  // Why a name fallback: a host that predates the evidence member reports only the name.
  const name = inspection.foregroundProcess
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
  let idleReads = 0
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
    idleReads = verdict === 'ended' ? idleReads + 1 : 0
    if (idleReads >= IDLE_READS_TO_END) {
      return 'ended'
    }
  }
  return 'running'
}
