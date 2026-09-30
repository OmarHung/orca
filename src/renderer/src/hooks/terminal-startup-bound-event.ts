export const ORCA_TERMINAL_STARTUP_BOUND_EVENT = 'orca:terminal-startup-bound'

export type TerminalStartupBoundEventDetail = {
  paneKey: string
}

/** Publishes the concrete pane ownership established before queued startup delivery. */
export function dispatchTerminalStartupBoundEvent(paneKey: string): void {
  if (typeof window.dispatchEvent !== 'function') {
    return
  }
  window.dispatchEvent(
    new CustomEvent<TerminalStartupBoundEventDetail>(ORCA_TERMINAL_STARTUP_BOUND_EVENT, {
      detail: { paneKey }
    })
  )
}
