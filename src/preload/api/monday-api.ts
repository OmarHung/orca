import type {
  MondayBoardSummary,
  MondayConnectionStatus,
  MondayItemDetail,
  MondayLoadScheduleRequest,
  MondayResult,
  MondaySchedule,
  MondayUser
} from '../../shared/monday/monday-types'

export type MondayApi = {
  status: () => Promise<MondayResult<MondayConnectionStatus>>
  /** Checks the personal API token with monday, then keeps it in the main process only. */
  connect: (token: string) => Promise<MondayResult<MondayConnectionStatus>>
  disconnect: () => Promise<MondayResult<MondayConnectionStatus>>
  listBoards: () => Promise<MondayResult<MondayBoardSummary[]>>
  /** Active people in the account, for the "show whose items" picker. */
  listUsers: () => Promise<MondayResult<MondayUser[]>>
  loadSchedule: (request: MondayLoadScheduleRequest) => Promise<MondayResult<MondaySchedule>>
  /** Board id → last-change time: one cheap call to tell whether a reload is needed. */
  boardsUpdatedAt: (boardIds: string[]) => Promise<MondayResult<Record<string, string>>>
  getItem: (itemId: string) => Promise<MondayResult<MondayItemDetail>>
}
