import { normalizeMondayDate } from '../../shared/monday/monday-schedule'
import type {
  MondayAccount,
  MondayBoardSummary,
  MondayColumnRoles,
  MondayItemDetail,
  MondayLabel,
  MondayScheduleItem,
  MondayUpdate,
  MondayUpdateReply
} from '../../shared/monday/monday-types'

/** monday's grey for an empty label. */
const NEUTRAL_LABEL_COLOR = '#c4c4c4'

export type RawMe = {
  id: string
  name: string
  email: string
  account: { slug: string; name: string }
}

export type RawBoardSummary = {
  id: string
  name: string
  type: string | null
  workspace: { name: string | null } | null
}

export type RawColumnValue = {
  id: string
  type: string
  text: string | null
  from?: string | null
  to?: string | null
  date?: string | null
  label?: string | null
  is_done?: boolean | null
  label_style?: { color?: string | null } | null
}

export type RawScheduleItem = {
  id: string
  name: string
  url: string
  group: { title: string; color: string | null } | null
  column_values: RawColumnValue[]
}

export type RawItemsPage = { cursor: string | null; items: RawScheduleItem[] }

type RawUpdateReply = {
  id: string
  body: string | null
  created_at: string | null
  creator: { name: string } | null
}

export type RawItemDetail = {
  id: string
  name: string
  url: string
  created_at: string | null
  updated_at: string | null
  creator: { name: string } | null
  board: { id: string; name: string } | null
  group: { title: string; color: string | null } | null
  description: { blocks: { type: string | null; content: string | null }[] | null } | null
  column_values: (RawColumnValue & { column: { title: string } | null })[]
  subitems:
    | { id: string; name: string; column_values: { type: string; text: string | null }[] }[]
    | null
  updates: (RawUpdateReply & { replies: RawUpdateReply[] | null })[] | null
}

export function mapAccount(me: RawMe): MondayAccount {
  return {
    userId: me.id,
    userName: me.name,
    email: me.email,
    accountSlug: me.account.slug,
    accountName: me.account.name
  }
}

export function mapBoardSummaries(boards: RawBoardSummary[]): MondayBoardSummary[] {
  // Docs and dashboards share the boards query; only real boards hold items.
  return boards
    .filter((board) => board.type === null || board.type === 'board')
    .map((board) => ({
      id: board.id,
      name: board.name,
      workspaceName: board.workspace?.name ?? null
    }))
}

function labelOf(value: RawColumnValue | undefined): MondayLabel | null {
  if (!value?.label) {
    return null
  }
  return { label: value.label, color: value.label_style?.color ?? NEUTRAL_LABEL_COLOR }
}

export function mapScheduleItem(
  raw: RawScheduleItem,
  boardId: string,
  roles: MondayColumnRoles
): MondayScheduleItem {
  const values = new Map(raw.column_values.map((value) => [value.id, value]))
  const valueOf = (columnId: string | null): RawColumnValue | undefined =>
    columnId ? values.get(columnId) : undefined
  const statusValue = valueOf(roles.statusColumnId)
  const status = labelOf(statusValue)
  const timelineValue = valueOf(roles.timelineColumnId)
  const timelineFrom = normalizeMondayDate(timelineValue?.from)
  const timelineTo = normalizeMondayDate(timelineValue?.to)
  return {
    id: raw.id,
    boardId,
    name: raw.name,
    url: raw.url,
    groupTitle: raw.group?.title ?? '',
    groupColor: raw.group?.color ?? null,
    status: status ? { ...status, isDone: statusValue?.is_done === true } : null,
    priority: labelOf(valueOf(roles.priorityColumnId)),
    peopleText: valueOf(roles.peopleColumnId)?.text ?? '',
    timeline: timelineFrom && timelineTo ? { from: timelineFrom, to: timelineTo } : null,
    startDate: normalizeMondayDate(valueOf(roles.startDateColumnId)?.date),
    dueDate: normalizeMondayDate(valueOf(roles.dueDateColumnId)?.date)
  }
}

function deltaText(content: string | null): string {
  if (!content) {
    return ''
  }
  try {
    const parsed: unknown = JSON.parse(content)
    const delta =
      parsed && typeof parsed === 'object' && 'deltaFormat' in parsed ? parsed.deltaFormat : null
    if (!Array.isArray(delta)) {
      return ''
    }
    return delta
      .map((op: unknown) =>
        op && typeof op === 'object' && 'insert' in op && typeof op.insert === 'string'
          ? op.insert
          : ''
      )
      .join('')
  } catch {
    return ''
  }
}

function mapDescription(description: RawItemDetail['description']): string | null {
  const text = (description?.blocks ?? [])
    .map((block) => deltaText(block.content))
    .join('\n')
    .trim()
  return text.length > 0 ? text : null
}

function mapReply(raw: RawUpdateReply): MondayUpdateReply {
  return {
    id: raw.id,
    creatorName: raw.creator?.name ?? '',
    createdAt: raw.created_at ?? '',
    bodyHtml: raw.body ?? ''
  }
}

function mapUpdate(raw: RawUpdateReply & { replies: RawUpdateReply[] | null }): MondayUpdate {
  return { ...mapReply(raw), replies: (raw.replies ?? []).map(mapReply) }
}

// Subitems are listed on their own; the rest show only when they hold something.
const HIDDEN_DETAIL_COLUMN_TYPES = new Set(['name', 'subtasks'])

export function mapItemDetail(raw: RawItemDetail): MondayItemDetail {
  return {
    id: raw.id,
    name: raw.name,
    url: raw.url,
    boardId: raw.board?.id ?? '',
    boardName: raw.board?.name ?? '',
    groupTitle: raw.group?.title ?? '',
    groupColor: raw.group?.color ?? null,
    creatorName: raw.creator?.name ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    columns: raw.column_values
      .filter((value) => !HIDDEN_DETAIL_COLUMN_TYPES.has(value.type) && value.text)
      .map((value) => ({
        id: value.id,
        title: value.column?.title ?? value.id,
        type: value.type,
        text: value.text ?? ''
      })),
    descriptionText: mapDescription(raw.description),
    subitems: (raw.subitems ?? []).map((subitem) => ({
      id: subitem.id,
      name: subitem.name,
      statusText: subitem.column_values.find((value) => value.type === 'status')?.text || null
    })),
    updates: (raw.updates ?? []).map(mapUpdate)
  }
}
