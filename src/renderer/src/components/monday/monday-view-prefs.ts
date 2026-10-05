import { z } from 'zod'
import { MONDAY_MAX_SCHEDULE_BOARDS } from '../../../../shared/monday/monday-types'

export type MondayView = 'month' | 'gantt'

const prefsSchema = z.object({
  boardIds: z.array(z.string().regex(/^\d{1,20}$/)).max(MONDAY_MAX_SCHEDULE_BOARDS),
  onlyMine: z.boolean(),
  hideDone: z.boolean(),
  view: z.enum(['month', 'gantt'])
})

export type MondayViewPrefs = z.infer<typeof prefsSchema>

export const DEFAULT_MONDAY_VIEW_PREFS: MondayViewPrefs = {
  boardIds: [],
  onlyMine: true,
  hideDone: false,
  view: 'month'
}

// Per-viewer convenience only: losing it just means picking boards again.
const STORAGE_KEY = 'orca.monday.page.v1'

export function readMondayViewPrefs(): MondayViewPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = prefsSchema.safeParse(raw ? JSON.parse(raw) : null)
    return parsed.success ? parsed.data : DEFAULT_MONDAY_VIEW_PREFS
  } catch {
    return DEFAULT_MONDAY_VIEW_PREFS
  }
}

export function writeMondayViewPrefs(prefs: MondayViewPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable (private profile); the page still works for this session.
  }
}
