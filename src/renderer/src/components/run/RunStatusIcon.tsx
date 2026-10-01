import React from 'react'
import { X } from 'lucide-react'
import { RunModeIcon } from './RunModeIcon'
import type { RunMode } from './run-mode'
import type { RunStatusTone } from './run-status-presentation'

/**
 * A run's status as its mode icon: pulsing while live, muted once finished, and badged with a red ✕
 * once failed (a red ▷ alone read as another Run button).
 */
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
      return (
        <span data-run-failed className="relative flex shrink-0">
          <RunModeIcon mode={mode} tone="finished" className="size-3" />
          <X
            aria-hidden
            strokeWidth={3}
            className="absolute -right-1 -bottom-1 size-2 text-destructive"
          />
        </span>
      )
  }
}
