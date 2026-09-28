import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { isWebClientLocation } from '@/lib/web-client-location'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { normalizeGitAutoFetchIntervalMinutes } from './git-auto-fetch-schedule'
import { runGitAutoFetchTick } from './git-auto-fetch-runner'

const TICK_MS = 60_000
const STARTUP_DELAY_MS = 60_000

/**
 * Runs `git fetch` for the active workspace's repository on the interval set in
 * Settings > Git. Paused while the window is hidden; the first visible tick
 * after that fetches if the interval has passed.
 */
export function useGitAutoFetch({ enabled }: { enabled: boolean }): void {
  const autoFetchEnabled = useAppStore((s) => s.settings?.gitAutoFetchEnabled === true)
  const intervalMinutes = useAppStore((s) => s.settings?.gitAutoFetchIntervalMinutes)

  useEffect(() => {
    // Why: a paired web client drives the same host as the desktop app, which already fetches.
    if (!enabled || !autoFetchEnabled || isWebClientLocation()) {
      return
    }
    const intervalMs = normalizeGitAutoFetchIntervalMinutes(intervalMinutes) * 60_000
    const enabledAt = Date.now()
    return installWindowVisibilityInterval({
      run: () =>
        runGitAutoFetchTick({
          now: Date.now(),
          intervalMs,
          enabledAt,
          startupDelayMs: STARTUP_DELAY_MS
        }),
      intervalMs: TICK_MS
    })
  }, [autoFetchEnabled, enabled, intervalMinutes])
}
