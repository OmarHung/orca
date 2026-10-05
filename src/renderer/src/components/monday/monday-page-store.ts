import { create } from 'zustand'
import { localIsoDate } from '../../../../shared/monday/monday-schedule'
import type {
  MondayBoardSummary,
  MondayConnectionStatus,
  MondayError,
  MondayItemDetail,
  MondaySchedule,
  MondayUser
} from '../../../../shared/monday/monday-types'
import { monthOf } from './monday-calendar-model'
import { readMondayViewPrefs, type MondayViewPrefs } from './monday-view-prefs'

export type MondayDetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: MondayItemDetail }
  | { status: 'error'; error: MondayError }

// Why its own store, not the app store: keeps the fork's page out of upstream's slices.
export type MondayPageState = {
  /** Null until the first status check answers. */
  connection: MondayConnectionStatus | null
  connectionError: MondayError | null
  boards: MondayBoardSummary[] | null
  boardsError: MondayError | null
  users: MondayUser[] | null
  usersError: MondayError | null
  /** Kept while a reload runs so the calendar doesn't blank out. */
  schedule: MondaySchedule | null
  scheduleLoading: boolean
  scheduleError: MondayError | null
  /** When the shown schedule was last read or confirmed unchanged (ms). */
  syncedAt: number | null
  prefs: MondayViewPrefs
  /** `YYYY-MM-01` of the month both views show. */
  anchorMonth: string
  selectedItemId: string | null
  details: Record<string, MondayDetailState>
  boardPickerOpen: boolean
}

export const useMondayPageStore = create<MondayPageState>(() => ({
  connection: null,
  connectionError: null,
  boards: null,
  boardsError: null,
  users: null,
  usersError: null,
  schedule: null,
  scheduleLoading: false,
  scheduleError: null,
  syncedAt: null,
  prefs: readMondayViewPrefs(),
  anchorMonth: monthOf(localIsoDate(new Date())),
  selectedItemId: null,
  details: {},
  boardPickerOpen: false
}))
