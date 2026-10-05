import type {
  MondayBoardSummary,
  MondayConnectionStatus,
  MondayItemDetail,
  MondayLoadScheduleRequest,
  MondayResult,
  MondaySchedule
} from '../../shared/monday/monday-types'

export type MondayApi = {
  status: () => Promise<MondayResult<MondayConnectionStatus>>
  /** Checks the personal API token with monday, then keeps it in the main process only. */
  connect: (token: string) => Promise<MondayResult<MondayConnectionStatus>>
  disconnect: () => Promise<MondayResult<MondayConnectionStatus>>
  listBoards: () => Promise<MondayResult<MondayBoardSummary[]>>
  loadSchedule: (request: MondayLoadScheduleRequest) => Promise<MondayResult<MondaySchedule>>
  getItem: (itemId: string) => Promise<MondayResult<MondayItemDetail>>
}
