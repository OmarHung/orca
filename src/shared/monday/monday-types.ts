import { z } from 'zod'

/** Pinned so a new monday default version can't change response shapes under us. */
export const MONDAY_API_VERSION = '2026-07'
export const MONDAY_API_URL = 'https://api.monday.com/v2'
/** Where users create a personal API token. */
export const MONDAY_TOKEN_HELP_URL =
  'https://developer.monday.com/api-reference/docs/authentication'
/** One schedule request batches this many boards; more would cost more than one API call. */
export const MONDAY_MAX_SCHEDULE_BOARDS = 10

export type MondayErrorKind =
  | 'not-connected'
  | 'unauthorized'
  | 'daily-limit'
  | 'rate-limited'
  | 'network'
  | 'api'

export type MondayError = { kind: MondayErrorKind; message: string }
export type MondayResult<T> = { ok: true; value: T } | { ok: false; error: MondayError }

export type MondayAccount = {
  userId: string
  userName: string
  email: string
  accountSlug: string
  accountName: string
}

export type MondayConnectionStatus = {
  account: MondayAccount | null
  /** True when the OS keychain is unavailable, so the token is kept only until Orca quits. */
  tokenKeptForSessionOnly: boolean
}

export type MondayUser = { id: string; name: string; email: string }

export type MondayBoardSummary = {
  id: string
  name: string
  workspaceName: string | null
}

/** Which of a board's own columns hold each schedule role (column ids differ per board). */
export type MondayColumnRoles = {
  statusColumnId: string | null
  priorityColumnId: string | null
  peopleColumnId: string | null
  timelineColumnId: string | null
  startDateColumnId: string | null
  dueDateColumnId: string | null
}

export type MondayColumnInfo = { id: string; title: string; type: string }

/** A status-style label; `color` is the hex monday assigns to it. */
export type MondayLabel = { label: string; color: string }

/** Inclusive calendar dates, `YYYY-MM-DD`. */
export type MondayDateRange = { from: string; to: string }

export type MondayScheduleItem = {
  id: string
  boardId: string
  name: string
  url: string
  groupTitle: string
  groupColor: string | null
  status: (MondayLabel & { isDone: boolean }) | null
  priority: MondayLabel | null
  peopleText: string
  timeline: MondayDateRange | null
  startDate: string | null
  dueDate: string | null
}

export type MondayBoardSchedule = {
  boardId: string
  boardName: string
  roles: MondayColumnRoles
  /** Columns behind each role, for showing which column fed a date. */
  roleTitles: Partial<Record<keyof MondayColumnRoles, string>>
  items: MondayScheduleItem[]
  /** The board had more matching items than Orca reads in one load. */
  truncated: boolean
}

export type MondaySchedule = { boards: MondayBoardSchedule[]; fetchedAt: number }

export type MondayItemColumnValue = {
  id: string
  title: string
  type: string
  text: string
  /** Label color, for status columns. */
  color: string | null
}

/** An item linked through a connect-boards column (e.g. the task's Web CRM record). */
export type MondayLinkedItem = {
  id: string
  name: string
  url: string
  boardName: string
  columns: MondayItemColumnValue[]
}

export type MondayItemRelation = { columnId: string; title: string; items: MondayLinkedItem[] }

export type MondayUpdateReply = {
  id: string
  creatorName: string
  createdAt: string
  bodyHtml: string
}

export type MondayUpdate = MondayUpdateReply & { replies: MondayUpdateReply[] }

export type MondaySubitem = { id: string; name: string; statusText: string | null }

export type MondayItemDetail = {
  id: string
  name: string
  url: string
  boardId: string
  boardName: string
  groupTitle: string
  groupColor: string | null
  creatorName: string | null
  createdAt: string | null
  updatedAt: string | null
  columns: MondayItemColumnValue[]
  relations: MondayItemRelation[]
  descriptionText: string | null
  subitems: MondaySubitem[]
  updates: MondayUpdate[]
}

// monday ids exceed int32, so they travel as digit strings end to end.
export const mondayIdSchema = z.string().regex(/^\d{1,20}$/)

export const mondayConnectSchema = z.object({ token: z.string().trim().min(1).max(4096) })

export const mondayLoadScheduleSchema = z.object({
  boardIds: z.array(mondayIdSchema).min(1).max(MONDAY_MAX_SCHEDULE_BOARDS),
  /** Only items whose people column has this user; null shows everyone's. */
  personId: mondayIdSchema.nullable(),
  /** With a person, also items nobody is assigned to. */
  includeUnassigned: z.boolean(),
  refresh: z.boolean()
})

export type MondayLoadScheduleRequest = z.infer<typeof mondayLoadScheduleSchema>
