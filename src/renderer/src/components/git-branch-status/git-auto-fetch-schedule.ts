export const GIT_AUTO_FETCH_INTERVAL_OPTIONS_MINUTES = [5, 15, 30, 60] as const
export const DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES = 15

/** Snaps a stored interval to one the settings UI offers, so a hand-edited value can't fetch every second. */
export function normalizeGitAutoFetchIntervalMinutes(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_GIT_AUTO_FETCH_INTERVAL_MINUTES
  }
  return GIT_AUTO_FETCH_INTERVAL_OPTIONS_MINUTES.reduce((closest, option) =>
    Math.abs(option - value) < Math.abs(closest - value) ? option : closest
  )
}

/**
 * A repository is due once a full interval has passed since its last attempt.
 * One never attempted this session waits `startupDelayMs` after auto fetch was
 * switched on, so launching Orca doesn't start a network fetch straight away.
 */
export function isGitAutoFetchDue({
  now,
  lastAttemptAt,
  intervalMs,
  enabledAt,
  startupDelayMs
}: {
  now: number
  lastAttemptAt: number | undefined
  intervalMs: number
  enabledAt: number
  startupDelayMs: number
}): boolean {
  if (lastAttemptAt !== undefined) {
    return now - lastAttemptAt >= intervalMs
  }
  return now - enabledAt >= startupDelayMs
}
