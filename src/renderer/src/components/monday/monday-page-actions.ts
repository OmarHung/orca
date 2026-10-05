import { localIsoDate } from '../../../../shared/monday/monday-schedule'
import type {
  MondayConnectionStatus,
  MondayError,
  MondaySchedule
} from '../../../../shared/monday/monday-types'
import { monthOf, shiftMonth } from './monday-calendar-model'
import { useMondayPageStore, type MondayPageState } from './monday-page-store'
import { writeMondayViewPrefs, type MondayViewPrefs } from './monday-view-prefs'

// Why a session cache: monday's daily API limit is shared by the whole account, so flipping
// back to a board set already read this session should not cost another call.
const scheduleCache = new Map<string, MondaySchedule>()
let shownScheduleKey: string | null = null
let scheduleRequest = 0

function get(): MondayPageState {
  return useMondayPageStore.getState()
}

function set(patch: Partial<MondayPageState>): void {
  useMondayPageStore.setState(patch)
}

/** The person to filter by: the saved choice, or the connected account when none was made. */
export function resolveMondayPersonId(
  prefs: MondayViewPrefs,
  connection: MondayConnectionStatus | null
): string | null {
  return prefs.personId === undefined ? (connection?.account?.userId ?? null) : prefs.personId
}

function scheduleKey(prefs: MondayViewPrefs, personId: string | null): string {
  const boards = [...prefs.boardIds].sort().join(',')
  return `${boards}|${personId ?? '*'}|${prefs.includeUnassigned}`
}

function resetMondayData(): void {
  scheduleCache.clear()
  shownScheduleKey = null
  scheduleRequest += 1
  set({
    boards: null,
    boardsError: null,
    users: null,
    usersError: null,
    schedule: null,
    scheduleError: null,
    scheduleLoading: false,
    selectedItemId: null,
    details: {}
  })
}

export async function loadMondayConnection(): Promise<void> {
  const result = await window.api.monday.status()
  set(
    result.ok
      ? { connection: result.value, connectionError: null }
      : { connectionError: result.error }
  )
}

/** Returns the error to show in the connect form, or null once connected. */
export async function connectMonday(token: string): Promise<MondayError | null> {
  const result = await window.api.monday.connect(token)
  if (!result.ok) {
    return result.error
  }
  resetMondayData()
  set({ connection: result.value, connectionError: null })
  return null
}

export async function disconnectMonday(): Promise<void> {
  const result = await window.api.monday.disconnect()
  resetMondayData()
  set(result.ok ? { connection: result.value } : { connectionError: result.error })
}

export async function loadMondayBoards(): Promise<void> {
  const result = await window.api.monday.listBoards()
  set(result.ok ? { boards: result.value, boardsError: null } : { boardsError: result.error })
}

export async function loadMondayUsers(): Promise<void> {
  const result = await window.api.monday.listUsers()
  set(result.ok ? { users: result.value, usersError: null } : { usersError: result.error })
}

export async function loadMondaySchedule(options: { refresh: boolean }): Promise<void> {
  const { prefs, connection } = get()
  const personId = resolveMondayPersonId(prefs, connection)
  if (prefs.boardIds.length === 0) {
    scheduleRequest += 1
    shownScheduleKey = null
    set({ schedule: null, scheduleError: null, scheduleLoading: false })
    return
  }
  const key = scheduleKey(prefs, personId)
  const cached = scheduleCache.get(key)
  if (cached && !options.refresh) {
    scheduleRequest += 1
    shownScheduleKey = key
    set({ schedule: cached, scheduleError: null, scheduleLoading: false })
    return
  }
  scheduleRequest += 1
  const request = scheduleRequest
  // A different board set must not show the previous set's items while it loads.
  set({
    scheduleLoading: true,
    scheduleError: null,
    ...(shownScheduleKey === key ? {} : { schedule: null })
  })
  const result = await window.api.monday.loadSchedule({
    boardIds: prefs.boardIds,
    personId,
    includeUnassigned: prefs.includeUnassigned,
    refresh: options.refresh
  })
  if (request !== scheduleRequest) {
    return
  }
  if (result.ok) {
    scheduleCache.set(key, result.value)
    shownScheduleKey = key
    set({ schedule: result.value, scheduleLoading: false })
  } else {
    set({ scheduleError: result.error, scheduleLoading: false })
  }
}

export function updateMondayPrefs(patch: Partial<MondayViewPrefs>): void {
  const prefs = { ...get().prefs, ...patch }
  writeMondayViewPrefs(prefs)
  set({ prefs })
  if ('boardIds' in patch || 'personId' in patch || 'includeUnassigned' in patch) {
    void loadMondaySchedule({ refresh: false })
  }
}

export function shiftMondayMonth(delta: number): void {
  set({ anchorMonth: shiftMonth(get().anchorMonth, delta) })
}

export function showMondayToday(): void {
  set({ anchorMonth: monthOf(localIsoDate(new Date())) })
}

export async function loadMondayItemDetail(itemId: string): Promise<void> {
  set({ details: { ...get().details, [itemId]: { status: 'loading' } } })
  const result = await window.api.monday.getItem(itemId)
  set({
    details: {
      ...get().details,
      [itemId]: result.ok
        ? { status: 'ready', detail: result.value }
        : { status: 'error', error: result.error }
    }
  })
}

export function selectMondayItem(itemId: string | null): void {
  set({ selectedItemId: itemId })
  if (itemId && !get().details[itemId]) {
    void loadMondayItemDetail(itemId)
  }
}

export async function refreshMonday(): Promise<void> {
  const selected = get().selectedItemId
  set({ details: {} })
  await Promise.all([
    loadMondaySchedule({ refresh: true }),
    selected ? loadMondayItemDetail(selected) : Promise.resolve()
  ])
}
