import React from 'react'
import { cn } from '@/lib/utils'
import type { RateLimitWindow } from '../../../../shared/rate-limit-types'
import {
  clampUsedPercent,
  getDisplayedUsagePercentage,
  type UsagePercentageDisplay
} from '../../../../shared/usage-percentage-display'
import { getUsagePacePercent, getUsageSeverity } from './usage-pace'

/**
 * Usage bar with a tick at the even-pace position (share of the window elapsed)
 * and a fill colored by how close the window is to its limit.
 */
export function UsagePaceBar({
  window,
  display,
  now,
  className,
  inverted = false,
  animated = false
}: {
  window: RateLimitWindow
  display: UsagePercentageDisplay
  now: number
  className?: string
  inverted?: boolean
  animated?: boolean
}): React.JSX.Element {
  const used = clampUsedPercent(window.usedPercent)
  const pace = getUsagePacePercent(window, now)
  const severity = getUsageSeverity(used, pace)
  // Why: in "% left" mode the fill shrinks from the right, so the pace tick mirrors too.
  // A 0% pace is an unstarted window (Codex floats resetsAt until first use); a tick at the edge is noise.
  const paceShown = pace === null || pace === 0 ? null : getDisplayedUsagePercentage(pace, display)

  return (
    <div data-usage-bar data-usage-severity={severity} className={cn('relative', className)}>
      <div
        className={cn(
          'h-full w-full overflow-hidden rounded-full',
          inverted ? 'bg-background/20' : 'bg-muted'
        )}
      >
        <div
          className={cn(
            'h-full rounded-full',
            animated && 'transition-all duration-300',
            severity === 'normal' && 'bg-status-success',
            severity === 'warning' && 'bg-status-warning',
            severity === 'critical' && 'bg-destructive'
          )}
          style={{ width: `${getDisplayedUsagePercentage(used, display)}%` }}
        />
      </div>
      {paceShown !== null ? (
        <span
          data-usage-pace-marker
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full',
            inverted ? 'bg-background/80' : 'bg-foreground/70'
          )}
          style={{ left: `${paceShown}%` }}
        />
      ) : null}
    </div>
  )
}
