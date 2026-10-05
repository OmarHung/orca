import type { SecretStore } from '../../shared/secret-store'
import type {
  MondayBoardSummary,
  MondayConnectionStatus,
  MondayItemDetail,
  MondayLoadScheduleRequest,
  MondaySchedule,
  MondayUser
} from '../../shared/monday/monday-types'
import { MondayAccountStore } from './monday-account-store'
import { MondayApiError, mondayGraphql } from './monday-graphql-client'
import {
  mapAccount,
  mapBoardSummaries,
  mapItemDetail,
  mapUsers,
  type RawBoardSummary,
  type RawItemDetail,
  type RawMe,
  type RawUser
} from './monday-mappers'
import {
  BOARDS_QUERY,
  BOARDS_UPDATED_AT_QUERY,
  ITEM_DETAIL_QUERY,
  ME_QUERY,
  USERS_PAGE_SIZE,
  USERS_QUERY
} from './monday-queries'
import { MondayScheduleLoader } from './monday-schedule-loader'

const BOARDS_PAGE_SIZE = 100
const MAX_BOARD_PAGES = 5
const MAX_USER_PAGES = 10

export type MondayServiceOptions = {
  dataDir: string
  secretStore: () => SecretStore
  /** Test-only fake server, read per call; production always talks to monday. */
  endpoint?: () => string | undefined
  graphql?: typeof mondayGraphql
  now?: () => number
}

/** Desktop-side monday access: the token never leaves the main process. */
export class MondayService {
  private readonly accounts: MondayAccountStore
  private readonly loader: MondayScheduleLoader
  private readonly graphql: typeof mondayGraphql
  private readonly endpoint: () => string | undefined
  // People rarely change; one read per connection keeps the picker off the shared daily limit.
  private users: Promise<MondayUser[]> | null = null

  constructor(options: MondayServiceOptions) {
    this.accounts = new MondayAccountStore(options.dataDir, options.secretStore)
    this.graphql = options.graphql ?? mondayGraphql
    this.endpoint = options.endpoint ?? (() => undefined)
    this.loader = new MondayScheduleLoader(
      (query, variables) => this.call(query, variables),
      options.now
    )
  }

  status(): MondayConnectionStatus {
    return {
      account: this.accounts.account(),
      tokenKeptForSessionOnly: this.accounts.isSessionOnly()
    }
  }

  async connect(token: string): Promise<MondayConnectionStatus> {
    const data = await this.graphql<{ me: RawMe | null }>(
      token,
      ME_QUERY,
      {},
      {
        endpoint: this.endpoint()
      }
    )
    if (!data.me) {
      throw new MondayApiError('unauthorized', 'The monday token was rejected.')
    }
    this.accounts.save(token, mapAccount(data.me))
    this.loader.clear()
    this.users = null
    return this.status()
  }

  disconnect(): MondayConnectionStatus {
    this.accounts.clear()
    this.loader.clear()
    this.users = null
    return this.status()
  }

  async listBoards(): Promise<MondayBoardSummary[]> {
    const boards: RawBoardSummary[] = []
    for (let page = 1; page <= MAX_BOARD_PAGES; page += 1) {
      const data = await this.call<{ boards: RawBoardSummary[] | null }>(BOARDS_QUERY, { page })
      const batch = data.boards ?? []
      boards.push(...batch)
      if (batch.length < BOARDS_PAGE_SIZE) {
        break
      }
    }
    return mapBoardSummaries(boards)
  }

  listUsers(): Promise<MondayUser[]> {
    if (!this.users) {
      this.users = this.readUsers().catch((error: unknown) => {
        this.users = null
        throw error
      })
    }
    return this.users
  }

  private async readUsers(): Promise<MondayUser[]> {
    const users: RawUser[] = []
    for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
      const data = await this.call<{ users: RawUser[] | null }>(USERS_QUERY, { page })
      const batch = data.users ?? []
      users.push(...batch)
      if (batch.length < USERS_PAGE_SIZE) {
        break
      }
    }
    return mapUsers(users)
  }

  /** Board id → monday's last-change time, for boards the token can still see. */
  async boardsUpdatedAt(boardIds: string[]): Promise<Record<string, string>> {
    const data = await this.call<{ boards: { id: string; updated_at: string | null }[] | null }>(
      BOARDS_UPDATED_AT_QUERY,
      { ids: boardIds }
    )
    return Object.fromEntries(
      (data.boards ?? []).map((board) => [board.id, board.updated_at ?? ''])
    )
  }

  loadSchedule(request: MondayLoadScheduleRequest): Promise<MondaySchedule> {
    return this.loader.load(request)
  }

  async getItem(itemId: string): Promise<MondayItemDetail> {
    const data = await this.call<{ items: RawItemDetail[] | null }>(ITEM_DETAIL_QUERY, {
      ids: [itemId]
    })
    const item = data.items?.[0]
    if (!item) {
      throw new MondayApiError('api', 'This item no longer exists, or you cannot see it.')
    }
    return mapItemDetail(item)
  }

  private async call<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const token = this.accounts.token()
    if (!token) {
      throw new MondayApiError('not-connected', 'monday is not connected.')
    }
    return this.graphql<T>(token, query, variables, { endpoint: this.endpoint() })
  }
}
