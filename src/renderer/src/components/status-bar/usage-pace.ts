import type { RateLimitWindow } from '../../../../shared/rate-limit-types'
import { clampUsedPercent } from '../../../../shared/usage-percentage-display'

export type UsageSeverity = 'normal' | 'warning' | 'critical'

const WARNING_USED_PERCENT = 75
const CRITICAL_USED_PERCENT = 90
// Why: early in a window the pace line sits near 0, so tiny usage would read as "ahead".
const MIN_PACE_PERCENT_FOR_PROJECTION = 10
const AHEAD_OF_PACE_TOLERANCE = 5
const MS_PER_MINUTE = 60_000

/**
 * Share of the window already elapsed (0–100) — where usage would sit if it were
 * spread evenly until reset. Null when the reset time or window length is unknown.
 */
export function getUsagePacePercent(
  window: Pick<RateLimitWindow, 'windowMinutes' | 'resetsAt'>,
  now: number
): number | null {
  const windowMs = window.windowMinutes * MS_PER_MINUTE
  if (window.resetsAt === null || !Number.isFinite(window.resetsAt) || !(windowMs > 0)) {
    return null
  }
  const remainingMs = window.resetsAt - now
  if (remainingMs < 0 || remainingMs > windowMs) {
    return null
  }
  return clampUsedPercent(((windowMs - remainingMs) / windowMs) * 100)
}

export function getUsageSeverity(usedPercent: number, pacePercent: number | null): UsageSeverity {
  const used = clampUsedPercent(usedPercent)
  const isAheadOfPace =
    pacePercent !== null &&
    pacePercent >= MIN_PACE_PERCENT_FOR_PROJECTION &&
    used > pacePercent + AHEAD_OF_PACE_TOLERANCE
  if (used >= CRITICAL_USED_PERCENT || (isAheadOfPace && used >= WARNING_USED_PERCENT)) {
    return 'critical'
  }
  if (used >= WARNING_USED_PERCENT || isAheadOfPace) {
    return 'warning'
  }
  return 'normal'
}

export function getUsageWindowSeverity(window: RateLimitWindow, now: number): UsageSeverity {
  return getUsageSeverity(window.usedPercent, getUsagePacePercent(window, now))
}
