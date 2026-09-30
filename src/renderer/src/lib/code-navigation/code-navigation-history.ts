/** A place in an editor tab that Navigate Back / Forward can return to. */
export type NavigationLocation = {
  worktreeId: string
  runtimeEnvironmentId: string | null
  filePath: string
  line: number
  column: number
}

type Stacks = { back: readonly NavigationLocation[]; forward: readonly NavigationLocation[] }

const MAX_ENTRIES = 50
const EMPTY: Stacks = { back: [], forward: [] }

function sameSpot(a: NavigationLocation, b: NavigationLocation): boolean {
  return a.filePath === b.filePath && a.line === b.line
}

function pushed(
  stack: readonly NavigationLocation[],
  location: NavigationLocation
): readonly NavigationLocation[] {
  const top = stack.at(-1)
  return top && sameSpot(top, location) ? stack : [...stack, location].slice(-MAX_ENTRIES)
}

export type NavigationHistory = {
  /** Remembers where a jump (go to declaration, a peek result …) started. */
  recordJump: (from: NavigationLocation) => void
  /** Follows the cursor; landing in another file means the user moved on from the last one. */
  noteLocation: (location: NavigationLocation) => void
  /** The location to go to, or null at the end of the history. */
  step: (direction: 'back' | 'forward', here: NavigationLocation) => NavigationLocation | null
}

/** JetBrains-style back/forward history, kept per workspace. */
export function createNavigationHistory(): NavigationHistory {
  const stacksByWorktree = new Map<string, Stacks>()
  let current: NavigationLocation | null = null
  // Why: the tab a step opens reports its location like any other; that arrival is not a move.
  let pendingArrival: string | null = null

  const stacksFor = (worktreeId: string): Stacks => stacksByWorktree.get(worktreeId) ?? EMPTY
  const moveOn = (from: NavigationLocation): void => {
    const stacks = stacksFor(from.worktreeId)
    stacksByWorktree.set(from.worktreeId, { back: pushed(stacks.back, from), forward: [] })
  }

  return {
    recordJump(from) {
      moveOn(from)
      current = from
    },
    noteLocation(location) {
      if (pendingArrival !== null && location.filePath === pendingArrival) {
        pendingArrival = null
      } else if (
        current &&
        current.worktreeId === location.worktreeId &&
        current.filePath !== location.filePath
      ) {
        moveOn(current)
      }
      current = location
    },
    step(direction, here) {
      const stacks = stacksFor(here.worktreeId)
      const source = direction === 'back' ? stacks.back : stacks.forward
      // Why skip: an entry for the spot we are on would make the key look dead.
      const remaining = [...source]
      let target = remaining.pop()
      while (target && sameSpot(target, here)) {
        target = remaining.pop()
      }
      if (!target) {
        return null
      }
      const destination = direction === 'back' ? stacks.forward : stacks.back
      const nextDestination = pushed(destination, here)
      stacksByWorktree.set(
        here.worktreeId,
        direction === 'back'
          ? { back: remaining, forward: nextDestination }
          : { back: nextDestination, forward: remaining }
      )
      pendingArrival = target.filePath === here.filePath ? null : target.filePath
      current = target
      return target
    }
  }
}

export const codeNavigationHistory = createNavigationHistory()
