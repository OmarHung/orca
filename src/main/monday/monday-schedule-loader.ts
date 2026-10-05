import {
  detectMondayColumnRoles,
  mondayRoleColumnIds
} from '../../shared/monday/monday-column-roles'
import type {
  MondayBoardSchedule,
  MondayColumnInfo,
  MondayColumnRoles,
  MondayLoadScheduleRequest,
  MondaySchedule
} from '../../shared/monday/monday-types'
import { mapScheduleItem, type RawItemsPage, type RawScheduleItem } from './monday-mappers'
import {
  BOARD_COLUMNS_QUERY,
  buildFirstSchedulePageQuery,
  ITEMS_PAGE_LIMIT,
  NEXT_SCHEDULE_PAGE_QUERY,
  type ScheduleBoardQuery
} from './monday-queries'

/** Four pages; a board with more matching items is marked truncated rather than read whole. */
export const MAX_ITEMS_PER_BOARD = ITEMS_PAGE_LIMIT * 4

export type MondayGraphqlCall = <T>(query: string, variables: Record<string, unknown>) => Promise<T>

type BoardColumnsEntry = {
  name: string
  roles: MondayColumnRoles
  roleTitles: MondayBoardSchedule['roleTitles']
}

type RawBoardColumns = { id: string; name: string; columns: MondayColumnInfo[] }

const ROLE_KEYS: (keyof MondayColumnRoles)[] = [
  'statusColumnId',
  'priorityColumnId',
  'peopleColumnId',
  'timelineColumnId',
  'startDateColumnId',
  'dueDateColumnId'
]

function roleTitlesOf(
  roles: MondayColumnRoles,
  columns: MondayColumnInfo[]
): MondayBoardSchedule['roleTitles'] {
  const titles: MondayBoardSchedule['roleTitles'] = {}
  for (const role of ROLE_KEYS) {
    const column = columns.find((entry) => entry.id === roles[role])
    if (column) {
      titles[role] = column.title
    }
  }
  return titles
}

/**
 * Reads the schedule columns of several boards. Board structure is cached for the session (it
 * rarely changes) so a normal load is one API call; `refresh` re-reads it.
 */
export class MondayScheduleLoader {
  private readonly boards = new Map<string, BoardColumnsEntry>()

  constructor(
    private readonly graphql: MondayGraphqlCall,
    private readonly now: () => number = Date.now
  ) {}

  clear(): void {
    this.boards.clear()
  }

  async load(request: MondayLoadScheduleRequest): Promise<MondaySchedule> {
    if (request.refresh) {
      request.boardIds.forEach((boardId) => this.boards.delete(boardId))
    }
    await this.ensureColumns(request.boardIds)
    const queries = request.boardIds.flatMap((boardId) => {
      const entry = this.boards.get(boardId)
      return entry
        ? [
            {
              boardId,
              roles: entry.roles,
              personId: request.personId,
              includeUnassigned: request.includeUnassigned,
              entry
            }
          ]
        : []
    })
    if (queries.length === 0) {
      return { boards: [], fetchedAt: this.now() }
    }
    const { query, variables } = buildFirstSchedulePageQuery(queries)
    const data = await this.graphql<
      Record<string, { updated_at: string | null; items_page: RawItemsPage }[] | null>
    >(query, variables)
    const boards: MondayBoardSchedule[] = []
    for (const [index, board] of queries.entries()) {
      const boardData = data[`b${index}`]?.[0]
      const firstPage = boardData?.items_page ?? { cursor: null, items: [] }
      const { items, truncated } = await this.collectPages(firstPage, board)
      boards.push({
        boardId: board.boardId,
        boardName: board.entry.name,
        roles: board.roles,
        roleTitles: board.entry.roleTitles,
        items: items.map((item) => mapScheduleItem(item, board.boardId, board.roles)),
        truncated,
        updatedAt: boardData?.updated_at ?? null
      })
    }
    return { boards, fetchedAt: this.now() }
  }

  private async ensureColumns(boardIds: string[]): Promise<void> {
    const missing = boardIds.filter((boardId) => !this.boards.has(boardId))
    if (missing.length === 0) {
      return
    }
    const data = await this.graphql<{ boards: RawBoardColumns[] | null }>(BOARD_COLUMNS_QUERY, {
      ids: missing
    })
    for (const board of data.boards ?? []) {
      const roles = detectMondayColumnRoles(board.columns)
      this.boards.set(board.id, {
        name: board.name,
        roles,
        roleTitles: roleTitlesOf(roles, board.columns)
      })
    }
  }

  private async collectPages(
    firstPage: RawItemsPage,
    board: ScheduleBoardQuery
  ): Promise<{ items: RawScheduleItem[]; truncated: boolean }> {
    const items = [...firstPage.items]
    let cursor = firstPage.cursor
    while (cursor && items.length < MAX_ITEMS_PER_BOARD) {
      const data = await this.graphql<{ next_items_page: RawItemsPage }>(NEXT_SCHEDULE_PAGE_QUERY, {
        cursor,
        columns: mondayRoleColumnIds(board.roles)
      })
      items.push(...data.next_items_page.items)
      cursor = data.next_items_page.cursor
    }
    return { items: items.slice(0, MAX_ITEMS_PER_BOARD), truncated: cursor !== null }
  }
}
