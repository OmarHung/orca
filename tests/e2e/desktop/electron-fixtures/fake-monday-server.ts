import { createServer, type IncomingMessage, type Server } from 'node:http'
import { FAKE_MONDAY_BOARDS } from './fake-monday-boards'
import {
  itemDetail,
  itemsPage,
  OMAR_ID,
  personFilter,
  stringList,
  BELLA_ID
} from './fake-monday-items'

type GraphqlRequest = { query: string; variables: Record<string, unknown> }

function parseRequest(body: string): GraphqlRequest {
  const parsed: unknown = JSON.parse(body)
  if (!parsed || typeof parsed !== 'object') {
    return { query: '', variables: {} }
  }
  const query = 'query' in parsed && typeof parsed.query === 'string' ? parsed.query : ''
  const raw = 'variables' in parsed ? parsed.variables : null
  const variables: Record<string, unknown> =
    raw && typeof raw === 'object' ? Object.fromEntries(Object.entries(raw)) : {}
  return { query, variables }
}

export type FakeStatusChange = { board: unknown; item: unknown; column: unknown; value: unknown }

type FakeState = {
  revision: number
  names: Map<string, string>
  statusChanges: FakeStatusChange[]
}

const FAKE_STATUS_SETTINGS = {
  labels: [
    { id: 0, label: 'In Progress', hex: '#fdab3d', index: 1, is_done: false },
    { id: 1, label: 'Done', hex: '#00c875', index: 2, is_done: true },
    { id: 2, label: 'Stuck', hex: '#df2f4a', index: 3, is_done: false },
    { id: 5, label: '', hex: '#c4c4c4', index: 0, is_done: false },
    { id: 9, label: 'Retired', hex: '#333333', index: 4, is_done: false, is_deactivated: true }
  ]
}

/** Every board's last-change time; renaming an item moves it forward. */
function boardsUpdatedAt(state: FakeState): string {
  return new Date(Date.UTC(2026, 9, 5) + state.revision * 1000).toISOString()
}

function respond(request: GraphqlRequest, state: FakeState): unknown {
  const { query, variables } = request
  if (query.includes('me {')) {
    return {
      me: {
        id: '30000001',
        name: 'Alice',
        email: 'alice@example.com',
        account: { slug: 'acme', name: 'Acme' }
      }
    }
  }
  if (query.includes('users(limit:')) {
    return {
      users: [
        {
          id: OMAR_ID,
          name: 'Alice',
          email: 'alice@example.com',
          kind: 'guest',
          status: 'ACTIVE',
          is_deleted: false
        },
        {
          id: BELLA_ID,
          name: 'Bella',
          email: 'bella@example.com',
          kind: 'guest',
          status: 'ACTIVE',
          is_deleted: false
        },
        {
          id: '30000004',
          name: 'Assistant',
          email: 'a@agent.monday.com',
          kind: 'personal_agent_member',
          status: 'ACTIVE',
          is_deleted: false
        }
      ]
    }
  }
  if (query.includes('boards(limit: 100')) {
    return {
      boards: [
        ...FAKE_MONDAY_BOARDS.map((board) => ({
          id: board.id,
          name: board.name,
          type: 'board',
          workspace: { name: 'Main workspace' }
        })),
        {
          id: '1000000004',
          name: '團隊文件',
          type: 'document',
          workspace: { name: 'Main workspace' }
        }
      ]
    }
  }
  if (query.includes('{ id updated_at }')) {
    const ids = stringList(variables.ids)
    return {
      boards: FAKE_MONDAY_BOARDS.filter((board) => ids.includes(board.id)).map((board) => ({
        id: board.id,
        updated_at: boardsUpdatedAt(state)
      }))
    }
  }
  if (query.includes('columns { id title type }')) {
    const ids = stringList(variables.ids)
    return {
      boards: FAKE_MONDAY_BOARDS.filter((board) => ids.includes(board.id)).map(
        ({ id, name, columns }) => ({
          id,
          name,
          columns
        })
      )
    }
  }
  if (query.includes('change_column_value(')) {
    const { board, item, column, value } = variables
    state.statusChanges.push({ board, item, column, value })
    return { change_column_value: { id: String(item) } }
  }
  if (query.includes('columns(ids: $columns) { id settings }')) {
    return { boards: [{ columns: [{ id: 'status', settings: FAKE_STATUS_SETTINGS }] }] }
  }
  if (query.includes('items(ids:')) {
    return { items: itemDetail(stringList(variables.ids)[0] ?? '', state.names) }
  }
  const data: Record<string, unknown> = {}
  for (let index = 0; Array.isArray(variables[`b${index}`]); index += 1) {
    const board = FAKE_MONDAY_BOARDS.find(
      (entry) => entry.id === stringList(variables[`b${index}`])[0]
    )
    const columnIds = stringList(variables[`c${index}`])
    data[`b${index}`] = board
      ? [
          {
            updated_at: boardsUpdatedAt(state),
            items_page: itemsPage(
              board,
              columnIds,
              personFilter(variables[`q${index}`]),
              state.names
            )
          }
        ]
      : []
  }
  return data
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export type FakeMondayServer = {
  url: string
  tokens: string[]
  /** Status writes Orca sent, in order. */
  statusChanges: FakeStatusChange[]
  /** Changes an item the way an edit on monday would, moving its board's updated_at forward. */
  renameItem: (itemId: string, name: string) => void
  close: () => Promise<void>
}

/** A local stand-in for api.monday.com that answers the queries Orca's monday page sends. */
export async function startFakeMondayServer(): Promise<FakeMondayServer> {
  const tokens: string[] = []
  const state: FakeState = { revision: 0, names: new Map(), statusChanges: [] }
  const server: Server = createServer((request, response) => {
    void readBody(request).then((body) => {
      tokens.push(String(request.headers.authorization ?? ''))
      const data = respond(parseRequest(body), state)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = address && typeof address === 'object' ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}/v2`,
    tokens,
    statusChanges: state.statusChanges,
    renameItem: (itemId, name) => {
      state.names.set(itemId, name)
      state.revision += 1
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
