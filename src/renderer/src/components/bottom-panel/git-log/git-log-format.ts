import { formatUiRelativeTime } from '@/i18n/relative-time-format'

const RELATIVE_WINDOW_MS = 24 * 60 * 60 * 1000

let absoluteFormatter: Intl.DateTimeFormat | null = null

function getAbsoluteFormatter(): Intl.DateTimeFormat {
  // Why OS locale: numeric date shapes conventionally follow the user's region, not UI language.
  absoluteFormatter ??= new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short'
  })
  return absoluteFormatter
}

/** Recent commits read as "9 minutes ago"; older ones as a short date + time, like JetBrains' log. */
export function formatGitLogDate(timestamp: number | undefined, now = Date.now()): string {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return ''
  }
  const diff = timestamp - now
  if (Math.abs(diff) < RELATIVE_WINDOW_MS) {
    return formatUiRelativeTime(diff)
  }
  return getAbsoluteFormatter().format(new Date(timestamp))
}

export function formatGitLogFullDate(timestamp: number | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return ''
  }
  return new Date(timestamp).toLocaleString()
}
