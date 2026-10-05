import type { MondayColumnInfo, MondayColumnRoles } from './monday-types'

const PRIORITY_TITLE = /priority|優先|优先/i
const STATUS_TITLE = /^\s*(status|狀態|状态)\s*$/i
const DUE_TITLE = /due|deadline|截止|到期|期限/i
const START_TITLE = /start|開始|开始|起始/i
const TIMELINE_TITLE = /timeline|時程|时程|時間軸|时间轴/i

function ofType(columns: MondayColumnInfo[], type: string): MondayColumnInfo[] {
  return columns.filter((column) => column.type === type)
}

function idOf(column: MondayColumnInfo | undefined): string | null {
  return column?.id ?? null
}

function pickDateRoles(dates: MondayColumnInfo[]): {
  startDateColumnId: string | null
  dueDateColumnId: string | null
} {
  const start = dates.find((column) => START_TITLE.test(column.title))
  const due =
    dates.find((column) => DUE_TITLE.test(column.title)) ??
    // Why: a lone untitled-looking date column is how most boards record a deadline.
    (dates.length === 1 && !start ? dates[0] : undefined)
  return { startDateColumnId: idOf(start), dueDateColumnId: idOf(due) }
}

/**
 * Guesses each schedule role from column types and titles, e.g. "Omars's Task" keeps its due
 * date in `date4` while "Project Cases" uses `date5` and adds a `timeline` column.
 */
export function detectMondayColumnRoles(columns: MondayColumnInfo[]): MondayColumnRoles {
  const statuses = ofType(columns, 'status')
  const timelines = ofType(columns, 'timeline')
  const priority = statuses.find((column) => PRIORITY_TITLE.test(column.title))
  const status =
    statuses.find((column) => STATUS_TITLE.test(column.title)) ??
    statuses.find((column) => column !== priority)
  return {
    statusColumnId: idOf(status),
    priorityColumnId: idOf(priority),
    peopleColumnId: idOf(ofType(columns, 'people')[0]),
    timelineColumnId: idOf(
      timelines.find((column) => TIMELINE_TITLE.test(column.title)) ?? timelines[0]
    ),
    ...pickDateRoles(ofType(columns, 'date'))
  }
}

export function mondayRoleColumnIds(roles: MondayColumnRoles): string[] {
  return Object.values(roles).filter((id): id is string => id !== null)
}
