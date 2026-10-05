import { getIntlLocale } from '@/i18n/i18n'
import { toDayNumber } from '../../../../shared/monday/monday-schedule'

const DAY_MS = 86_400_000

function dayDate(day: number): Date {
  return new Date(day * DAY_MS)
}

// Day numbers are UTC midnights, so every formatter pins UTC to keep the calendar date.
function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getIntlLocale(), { timeZone: 'UTC', ...options })
}

export function formatMondayDay(isoDate: string): string {
  return formatter({ month: 'numeric', day: 'numeric', weekday: 'short' }).format(
    dayDate(toDayNumber(isoDate))
  )
}

export function formatMondayMonth(anchorMonth: string): string {
  return formatter({ year: 'numeric', month: 'long' }).format(dayDate(toDayNumber(anchorMonth)))
}

export function formatMondayShortMonth(day: number): string {
  return formatter({ month: 'short' }).format(dayDate(day))
}

/** Monday-first short weekday names. */
export function mondayWeekdayNames(style: 'short' | 'narrow'): string[] {
  const monday = toDayNumber('2026-01-05')
  const format = formatter({ weekday: style })
  return Array.from({ length: 7 }, (_, index) => format.format(dayDate(monday + index)))
}

/** A monday timestamp (update posted, item created) in the viewer's time zone. */
export function formatMondayTimestamp(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return toDayNumber(toIso) - toDayNumber(fromIso)
}
