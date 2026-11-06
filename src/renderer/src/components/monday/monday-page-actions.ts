import { localIsoDate } from '../../../../shared/monday/monday-schedule'
import type {
  MondayConnectionStatus,
  MondayError,
  MondayItemDetail,
  MondaySchedule,
  MondayScheduleItem,
  MondayStatusOption
} from '../../../../shared/monday/monday-types'
import { monthOf, shiftMonth } from './monday-calendar-model'
import { useMondayPageStore, type MondayPageState } from './monday-page-store'
import { writeMondayViewPrefs, type MondayViewPrefs } from './monday-view-prefs'

// Why a session cache: monday's daily API limit is shared by the whole account, so flipping
// back to a board set already read this session should not cost another call.
const scheduleCache = new Map<string, MondaySchedule>()
let shownScheduleKey: string | null = null
let scheduleRequest = 0
let changeCheckRunning = false

/** Opening the page and focusing the window often fire together; one check covers both. */
const MIN_CHANGE_CHECK_GAP_MS = 3_000

/** Attachment links monday hands out expire after an hour; re-read details a little before that. */
const DETAIL_MAX_AGE_MS = 50 * 60_000

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
    details: {},
    statusOptions: {}
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
    set({ schedule: result.value, scheduleLoading: false, syncedAt: Date.now() })
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
        ? { status: 'ready', detail: result.value, loadedAt: Date.now() }
        : { status: 'error', error: result.error }
    }
  })
}

function detailIsStale(itemId: string): boolean {
  const state = get().details[itemId]
  return !state || (state.status === 'ready' && Date.now() - state.loadedAt > DETAIL_MAX_AGE_MS)
}

export function selectMondayItem(itemId: string | null): void {
  set({ selectedItemId: itemId })
  if (itemId && detailIsStale(itemId)) {
    void loadMondayItemDetail(itemId)
  }
}

export function mondayStatusColumnKey(boardId: string, columnId: string): string {
  return `${boardId}:${columnId}`
}

export async function loadMondayStatusOptions(boardId: string, columnId: string): Promise<void> {
  const key = mondayStatusColumnKey(boardId, columnId)
  set({ statusOptions: { ...get().statusOptions, [key]: { status: 'loading' } } })
  const result = await window.api.monday.statusOptions({ boardId, columnId })
  set({
    statusOptions: {
      ...get().statusOptions,
      [key]: result.ok
        ? { status: 'ready', options: result.value }
        : { status: 'error', error: result.error }
    }
  })
}

type ItemStatus = MondayScheduleItem['status']

function scheduleWithStatus(
  schedule: MondaySchedule,
  itemId: string,
  status: ItemStatus
): MondaySchedule {
  return {
    ...schedule,
    boards: schedule.boards.map((board) =>
      board.items.some((item) => item.id === itemId)
        ? {
            ...board,
            items: board.items.map((item) => (item.id === itemId ? { ...item, status } : item))
          }
        : board
    )
  }
}

function detailWithStatus(
  detail: MondayItemDetail,
  columnId: string,
  status: ItemStatus
): MondayItemDetail {
  return {
    ...detail,
    columns: detail.columns.map((column) =>
      column.id === columnId
        ? { ...column, text: status?.label ?? '', color: status?.color ?? null }
        : column
    )
  }
}

function showItemStatus(itemId: string, columnId: string, status: ItemStatus): void {
  for (const [key, cached] of scheduleCache) {
    scheduleCache.set(key, scheduleWithStatus(cached, itemId, status))
  }
  const { schedule, details } = get()
  const detailState = details[itemId]
  set({
    schedule: schedule ? scheduleWithStatus(schedule, itemId, status) : schedule,
    details:
      detailState?.status === 'ready'
        ? {
            ...details,
            [itemId]: {
              ...detailState,
              detail: detailWithStatus(detailState.detail, columnId, status)
            }
          }
        : details
  })
}

function currentItemStatus(itemId: string): ItemStatus {
  for (const board of get().schedule?.boards ?? []) {
    const item = board.items.find((candidate) => candidate.id === itemId)
    if (item) {
      return item.status
    }
  }
  return null
}

/** Shows the new status at once and writes it to monday; puts the old one back if that fails. */
export async function setMondayItemStatus(
  target: { boardId: string; itemId: string; columnId: string },
  option: MondayStatusOption
): Promise<MondayError | null> {
  const previous = currentItemStatus(target.itemId)
  // monday's blank label is how an item shows "no status".
  const next = option.label
    ? { label: option.label, color: option.color, isDone: option.isDone }
    : null
  showItemStatus(target.itemId, target.columnId, next)
  const result = await window.api.monday.setStatus({ ...target, labelId: option.id })
  if (!result.ok) {
    showItemStatus(target.itemId, target.columnId, previous)
    return result.error
  }
  return null
}

export async function refreshMonday(): Promise<void> {
  const selected = get().selectedItemId
  set({ details: {} })
  await Promise.all([
    loadMondaySchedule({ refresh: true }),
    selected ? loadMondayItemDetail(selected) : Promise.resolve()
  ])
}

/**
 * Re-reads the schedule only when monday says a shown board changed: one cheap call when nothing
 * did. Runs when the page opens and when the window regains focus, instead of polling.
 */
export async function checkMondayForChanges(): Promise<void> {
  const { schedule, scheduleLoading, syncedAt } = get()
  if (!schedule || schedule.boards.length === 0 || scheduleLoading || changeCheckRunning) {
    return
  }
  if (syncedAt !== null && Date.now() - syncedAt < MIN_CHANGE_CHECK_GAP_MS) {
    return
  }
  changeCheckRunning = true
  try {
    const result = await window.api.monday.boardsUpdatedAt(
      schedule.boards.map((board) => board.boardId)
    )
    if (!result.ok) {
      set({ scheduleError: result.error })
      return
    }
    const changed = schedule.boards.some((board) => result.value[board.boardId] !== board.updatedAt)
    if (changed) {
      await refreshMonday()
    } else {
      set({ syncedAt: Date.now() })
    }
  } finally {
    changeCheckRunning = false
  }
}
