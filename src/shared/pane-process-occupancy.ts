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
  /** Parent and group per pid, from the same pass, so ancestry needs no second walk. */
  parentByPid: ReadonlyMap<number, { ppid: number; pgid: number | undefined }>
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
  const parentByPid = new Map<number, { ppid: number; pgid: number | undefined }>()
  let processGroupsIncomplete = false
  for (const row of rows) {
    parentByPid.set(row.pid, { ppid: row.ppid, pgid: row.pgid })
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
    parentByPid,
    stoppedTtys,
    rowsByProcessGroup,
    processGroupsIncomplete
  }
  paneOccupancyByCapture.set(rows, occupancy)
  return occupancy
}

/** Process groups of the shell's ancestors (the login wrapper), which hold the terminal but run no work. */
function ancestorProcessGroups(
  parentByPid: PaneOccupancy['parentByPid'],
  root: ProcessTableRow
): Set<number> {
  const groups = new Set<number>()
  const seen = new Set<number>([root.pid])
  let parent = parentByPid.get(root.ppid)
  let ppid = root.ppid
  while (parent && !seen.has(ppid)) {
    seen.add(ppid)
    if (parent.pgid !== undefined) {
      groups.add(parent.pgid)
    }
    ppid = parent.ppid
    parent = parentByPid.get(ppid)
  }
  return groups
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
  // Why ignore ancestors: `login` holds the same terminal in its own group but runs no work.
  const ancestors = ancestorProcessGroups(occupancy.parentByPid, root)
  const busyGroups = [...(occupancy.processGroupsByTty.get(root.tpgid) ?? [])].filter(
    (group) => !ancestors.has(group)
  )
  // The root always counts itself, so exactly one row in its group means the group IS the shell.
  return (
    root.tpgid === root.pgid &&
    busyGroups.length === 1 &&
    busyGroups[0] === root.pgid &&
    !occupancy.stoppedTtys.has(root.tpgid) &&
    !occupancy.processGroupsIncomplete &&
    occupancy.rowsByProcessGroup.get(root.pgid) === 1
  )
}
