import { useEffect, useState } from 'react'
import { localIsoDate } from '../../../../shared/monday/monday-schedule'

const DATE_CHECK_INTERVAL_MS = 60_000

/** Today's local date; re-checked every minute so a page left open rolls over at midnight. */
export function useMondayToday(): string {
  const [today, setToday] = useState(() => localIsoDate(new Date()))
  useEffect(() => {
    const timer = window.setInterval(
      () => setToday(localIsoDate(new Date())),
      DATE_CHECK_INTERVAL_MS
    )
    return () => window.clearInterval(timer)
  }, [])
  return today
}
