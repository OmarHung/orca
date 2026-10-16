import type { ProcessTableRow } from './process-table-snapshot'

/** The two units a forced stop can reach, indexed from one capture: which process groups occupy
 *  each controlling terminal (which terminals hold a stopped process), and how many rows belong to
 *  each process group anywhere on the host. */
type PaneOccupancy = {
  processGroupsByTty: ReadonlyMap<number, ReadonlySet<number>>
  stoppedTtys: ReadonlySet<number>
  /** Rows per `pgid`, counted over the WHOLE table with no tty filter — that is the point of it.
   *  A member that shares the shell's group but has no controlling terminal is reachable by
   *  `killpg` and invisible to every tty-shaped index. */
  rowsByProcessGroup: ReadonlyMap<number, number>
  /** True when some row carried no `pgid`, so the group counts are incomplete and cannot support
   *  an idleness claim. */
  processGroupsIncomplete: boolean
}

const paneOccupancyByCapture = new WeakMap<readonly ProcessTableRow[], PaneOccupancy>()

/** Index the capture by controlling terminal and by process group.
 *
 *  The tty half is keyed on `tpgid` because the snapshot carries no tty column and does not need
 *  one: a process group belongs to exactly one session, a session to at most one controlling
 *  terminal, so two rows reporting the same live `tpgid` are on the same tty. Memoized per capture,
 *  since the per-pane cadence poll and `pty.listProcesses` share one TTL-cached table. */
function getPaneOccupancy(rows: readonly ProcessTableRow[]): PaneOccupancy {
  const cached = paneOccupancyByCapture.get(rows)
  if (cached) {
    return cached
  }
  const processGroupsByTty = new Map<number, Set<number>>()
  const stoppedTtys = new Set<number>()
  const rowsByProcessGroup = new Map<number, number>()
  let processGroupsIncomplete = false
  for (const row of rows) {
    if (row.pgid === undefined) {
      processGroupsIncomplete = true
      continue
    }
    rowsByProcessGroup.set(row.pgid, (rowsByProcessGroup.get(row.pgid) ?? 0) + 1)
    if (row.tpgid === undefined || row.tpgid <= 0) {
      continue
    }
    let groups = processGroupsByTty.get(row.tpgid)
    if (!groups) {
      groups = new Set<number>()
      processGroupsByTty.set(row.tpgid, groups)
    }
    groups.add(row.pgid)
    // `T` is a job-control stop (Ctrl-Z), `t` a tracing stop. Both are work the pane still holds.
    if (row.stat.startsWith('T') || row.stat.startsWith('t')) {
      stoppedTtys.add(row.tpgid)
    }
  }
  const occupancy: PaneOccupancy = {
    processGroupsByTty,
    stoppedTtys,
    rowsByProcessGroup,
    processGroupsIncomplete
  }
  paneOccupancyByCapture.set(rows, occupancy)
  return occupancy
}

/** Whether the pane's shell is the only thing running in it, so nothing is in front or behind it. */
export function paneShellOwnsEveryTtyProcessGroup(
  rows: readonly ProcessTableRow[],
  root: ProcessTableRow
): boolean {
  if (root.pgid === undefined || root.tpgid === undefined) {
    return false
  }
  const occupancy = getPaneOccupancy(rows)
  // The root always counts itself, so exactly one row in its group means the group IS the shell.
  return (
    root.tpgid === root.pgid &&
    occupancy.processGroupsByTty.get(root.tpgid)?.size === 1 &&
    occupancy.processGroupsByTty.get(root.tpgid)?.has(root.pgid) === true &&
    !occupancy.stoppedTtys.has(root.tpgid) &&
    !occupancy.processGroupsIncomplete &&
    occupancy.rowsByProcessGroup.get(root.pgid) === 1
  )
}
