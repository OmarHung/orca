/** A launch still running Before launch steps or starting compound members. */
export type PendingLaunch = { worktreeId: string; reference: string; cancelled: boolean }

const pendingLaunches = new Set<PendingLaunch>()

/** Keeps launches in progress from starting anything more; without a reference, all in the worktree. */
export function cancelPendingLaunches(worktreeId: string, reference?: string): void {
  for (const pending of pendingLaunches) {
    if (
      pending.worktreeId === worktreeId &&
      (reference === undefined || pending.reference === reference)
    ) {
      pending.cancelled = true
    }
  }
}

/** Runs `launch` as a pending launch of `reference`, replacing one of it still starting. */
export async function withPendingLaunch(
  worktreeId: string,
  reference: string,
  launch: (pending: PendingLaunch) => Promise<void>
): Promise<void> {
  cancelPendingLaunches(worktreeId, reference)
  const pending: PendingLaunch = { worktreeId, reference, cancelled: false }
  pendingLaunches.add(pending)
  try {
    await launch(pending)
  } finally {
    pendingLaunches.delete(pending)
  }
}
