import React from 'react'
import { RunModeIcon } from './RunModeIcon'
import type { RunMode } from './run-mode'
import type { RunStatusTone } from './run-status-presentation'

/** A run's status as its mode icon; it pulses while the run is live. */
export function RunStatusIcon({
  tone,
  mode
}: {
  tone: RunStatusTone
  mode: RunMode
}): React.JSX.Element | null {
  switch (tone) {
    case 'idle':
      return null
    case 'running':
      return <RunModeIcon mode={mode} className="size-3 animate-pulse" />
    case 'success':
      return <RunModeIcon mode={mode} tone="finished" className="size-3" />
    case 'failure':
      return <RunModeIcon mode={mode} tone="failed" className="size-3" />
  }
}
