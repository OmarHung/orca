import { getLocalPtyProvider } from '../ipc/pty/provider/registry'
import { readProcessTable } from '../pty-descendant-termination'
import { readWindowsProcessIdentityTable } from '../windows/windows-process-table'

/** Deeper than any real shell → tool → server chain; also stops a ppid cycle. */
const MAX_ANCESTRY_DEPTH = 64

/** Each pid's terminal (by PTY id) found by walking parent links up to a terminal's root process. */
export function terminalsOfPids(
  pids: readonly number[],
  terminalByRootPid: ReadonlyMap<number, string>,
  parentByPid: ReadonlyMap<number, number>
): Record<number, string | null> {
  const result: Record<number, string | null> = {}
  for (const pid of pids) {
    let current: number | undefined = pid
    let terminal: string | null = null
    for (
      let depth = 0;
      current !== undefined && current > 1 && depth < MAX_ANCESTRY_DEPTH;
      depth++
    ) {
      terminal = terminalByRootPid.get(current) ?? null
      if (terminal) {
        break
      }
      current = parentByPid.get(current)
    }
    result[pid] = terminal
  }
  return result
}

async function readParentLinks(): Promise<Map<number, number>> {
  const rows: readonly { pid: number; ppid: number }[] =
    process.platform === 'win32'
      ? await readWindowsProcessIdentityTable()
      : (await readProcessTable()).rows
  return new Map(rows.map((row): [number, number] => [row.pid, row.ppid]))
}

/**
 * Which local terminal each listening pid runs under, so a Run shows only its own ports when
 * several run in one workspace. WSL and SSH terminals are left out: their pids are another host's.
 */
export async function findListenerTerminals(
  pids: readonly number[]
): Promise<Record<number, string | null>> {
  const sessions = await getLocalPtyProvider().listProcesses()
  const terminalByRootPid = new Map(
    sessions.flatMap((session) =>
      session.rootProcessId !== undefined && !session.wslDistro
        ? [[session.rootProcessId, session.id] as const]
        : []
    )
  )
  return terminalsOfPids(pids, terminalByRootPid, await readParentLinks())
}
