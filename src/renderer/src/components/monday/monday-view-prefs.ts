import { z } from 'zod'
import { MONDAY_MAX_SCHEDULE_BOARDS } from '../../../../shared/monday/monday-types'

export type MondayView = 'month' | 'gantt'

const MONDAY_ID = /^\d{1,20}$/

// Why per-field fallbacks: a saved shape from an older build keeps its boards instead of resetting.
const prefsSchema = z.object({
  boardIds: z.array(z.string().regex(MONDAY_ID)).max(MONDAY_MAX_SCHEDULE_BOARDS).catch([]),
  /** Whose items to show: unset means the connected account, null means everyone. */
  personId: z.string().regex(MONDAY_ID).nullable().optional().catch(undefined),
  includeUnassigned: z.boolean().catch(true),
  hideDone: z.boolean().catch(false),
  /** Status labels to show; empty shows every status. */
  statusLabels: z.array(z.string()).catch([]),
  view: z.enum(['month', 'gantt']).catch('month')
})

export type MondayViewPrefs = z.infer<typeof prefsSchema>

export const DEFAULT_MONDAY_VIEW_PREFS: MondayViewPrefs = {
  boardIds: [],
  includeUnassigned: true,
  hideDone: false,
  statusLabels: [],
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
