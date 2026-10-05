import type { MondayColumnRoles } from '../../shared/monday/monday-types'
import { mondayRoleColumnIds } from '../../shared/monday/monday-column-roles'

export const ITEMS_PAGE_LIMIT = 500

export const ME_QUERY = `query { me { id name email account { slug name } } }`

export const BOARDS_QUERY = `query ($page: Int!) {
  boards(limit: 100, page: $page, state: active, order_by: used_at) {
    id name type workspace { name }
  }
}`

export const USERS_PAGE_SIZE = 100

export const USERS_QUERY = `query ($page: Int!) {
  users(limit: ${USERS_PAGE_SIZE}, page: $page) { id name email kind status is_deleted }
}`

export const BOARD_COLUMNS_QUERY = `query ($ids: [ID!]) {
  boards(ids: $ids) { id name columns { id title type } }
}`

const SCHEDULE_ITEM_FIELDS = (columnsVariable: string): string => `cursor items {
  id name url
  group { title color }
  column_values(ids: ${columnsVariable}) {
    id type text
    ... on TimelineValue { from to }
    ... on DateValue { date }
    ... on StatusValue { label is_done label_style { color } }
  }
}`

export type ScheduleBoardQuery = {
  boardId: string
  roles: MondayColumnRoles
  personId: string | null
  includeUnassigned: boolean
}

// Why a person id, not monday's `assigned_to_me`: that means the token's owner, who may not be
// the person using Orca. Unassigned items matter because personal boards ("Omars's Task") leave
// most items without a person.
function itemsQueryParams(board: ScheduleBoardQuery): Record<string, unknown> | null {
  const column = board.roles.peopleColumnId
  if (!board.personId || !column) {
    return null
  }
  const person = {
    column_id: column,
    compare_value: [`person-${board.personId}`],
    operator: 'any_of'
  }
  if (!board.includeUnassigned) {
    return { rules: [person] }
  }
  return {
    operator: 'or',
    rules: [person, { column_id: column, compare_value: [], operator: 'is_empty' }]
  }
}

/** First page of every board in one call: each board is an alias with its own column ids. */
export function buildFirstSchedulePageQuery(boards: ScheduleBoardQuery[]): {
  query: string
  variables: Record<string, unknown>
} {
  const declarations: string[] = []
  const selections: string[] = []
  const variables: Record<string, unknown> = {}
  boards.forEach((board, index) => {
    declarations.push(`$b${index}: [ID!]`, `$c${index}: [String!]`, `$q${index}: ItemsQuery`)
    selections.push(
      `b${index}: boards(ids: $b${index}) {
        items_page(limit: ${ITEMS_PAGE_LIMIT}, query_params: $q${index}) {
          ${SCHEDULE_ITEM_FIELDS(`$c${index}`)}
        }
      }`
    )
    variables[`b${index}`] = [board.boardId]
    variables[`c${index}`] = mondayRoleColumnIds(board.roles)
    variables[`q${index}`] = itemsQueryParams(board)
  })
  return {
    query: `query (${declarations.join(', ')}) {\n${selections.join('\n')}\n}`,
    variables
  }
}

export const NEXT_SCHEDULE_PAGE_QUERY = `query ($cursor: String!, $columns: [String!]) {
  next_items_page(limit: ${ITEMS_PAGE_LIMIT}, cursor: $cursor) {
    ${SCHEDULE_ITEM_FIELDS('$columns')}
  }
}`

// Why display_value: connected-board, mirror and dependency columns return an empty `text`.
// Linked items come with their own columns so the panel can show e.g. the task's Web CRM record.
export const ITEM_DETAIL_QUERY = `query ($ids: [ID!]) {
  items(ids: $ids) {
    id name url created_at updated_at
    creator { name }
    board { id name }
    group { title color }
    description { blocks { type content } }
    column_values {
      id type text column { title }
      ... on StatusValue { label_style { color } }
      ... on BoardRelationValue {
        display_value
        linked_items {
          id name url board { name }
          column_values {
            id type text column { title }
            ... on StatusValue { label_style { color } }
            ... on MirrorValue { display_value }
          }
        }
      }
      ... on MirrorValue { display_value }
      ... on DependencyValue { display_value }
    }
    subitems { id name column_values { type text } }
    updates(limit: 50) {
      id body created_at creator { name }
      replies { id body created_at creator { name } }
    }
  }
}`
