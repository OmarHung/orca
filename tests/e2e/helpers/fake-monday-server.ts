import { createServer, type IncomingMessage, type Server } from 'node:http'
import { FAKE_MONDAY_BOARDS } from './fake-monday-boards'
import {
  itemDetail,
  itemsPage,
  OMAR_ID,
  personFilter,
  stringList,
  VIVIAN_ID
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

type FakeState = { revision: number; names: Map<string, string> }

/** Every board's last-change time; renaming an item moves it forward. */
function boardsUpdatedAt(state: FakeState): string {
  return new Date(Date.UTC(2026, 9, 5) + state.revision * 1000).toISOString()
}

function respond(request: GraphqlRequest, state: FakeState): unknown {
  const { query, variables } = request
  if (query.includes('me {')) {
    return {
      me: {
        id: '69175796',
        name: 'Omar',
        email: 'omar@example.com',
        account: { slug: 'autrontech', name: 'Autron' }
      }
    }
  }
  if (query.includes('users(limit:')) {
    return {
      users: [
        {
          id: OMAR_ID,
          name: 'Omar',
          email: 'omar@example.com',
          kind: 'guest',
          status: 'ACTIVE',
          is_deleted: false
        },
        {
          id: VIVIAN_ID,
          name: 'Vivian',
          email: 'vivian@example.com',
          kind: 'guest',
          status: 'ACTIVE',
          is_deleted: false
        },
        {
          id: '117170086',
          name: 'Aurora',
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
          id: '9847013437',
          name: '遠端連線方式',
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
  /** Changes an item the way an edit on monday would, moving its board's updated_at forward. */
  renameItem: (itemId: string, name: string) => void
  close: () => Promise<void>
}

/** A local stand-in for api.monday.com that answers the queries Orca's monday page sends. */
export async function startFakeMondayServer(): Promise<FakeMondayServer> {
  const tokens: string[] = []
  const state: FakeState = { revision: 0, names: new Map() }
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
    renameItem: (itemId, name) => {
      state.names.set(itemId, name)
      state.revision += 1
    },
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
