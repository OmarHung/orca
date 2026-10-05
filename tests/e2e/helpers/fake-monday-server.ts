import { createServer, type IncomingMessage, type Server } from 'node:http'
import { dayOffset, FAKE_MONDAY_BOARDS, type FakeItem } from './fake-monday-boards'

function peopleText(item: FakeItem): string {
  return item.mine === null ? '' : item.mine ? 'Omar' : 'Vivian'
}

function columnValue(
  column: { id: string; type: string },
  item: FakeItem
): Record<string, unknown> {
  const base = { id: column.id, type: column.type }
  if (column.type === 'people') {
    return { ...base, text: peopleText(item) }
  }
  if (column.type === 'status') {
    const { label, color, done } = item.status
    return { ...base, text: label, label, is_done: done, label_style: { color } }
  }
  if (column.type === 'timeline') {
    const range = item.timeline
    return range
      ? {
          ...base,
          text: '',
          from: `${dayOffset(range[0])}T00:00:00+00:00`,
          to: `${dayOffset(range[1])}T00:00:00+00:00`
        }
      : { ...base, text: '', from: null, to: null }
  }
  if (column.type === 'date') {
    const offset = column.id === 'date__1' ? item.start : item.due
    const date = offset === undefined ? '' : dayOffset(offset)
    return { ...base, text: date, date }
  }
  return { ...base, text: '' }
}

function itemsPage(
  board: (typeof FAKE_MONDAY_BOARDS)[number],
  columnIds: string[],
  onlyMine: boolean
): unknown {
  const columns = board.columns.filter((column) => columnIds.includes(column.id))
  const items = board.items.filter((item) => !onlyMine || item.mine !== false)
  return {
    cursor: null,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      url: `https://autrontech.monday.com/boards/${board.id}/pulses/${item.id}`,
      group: { title: item.group, color: '#579bfc' },
      column_values: columns.map((column) => columnValue(column, item))
    }))
  }
}

function itemDetail(itemId: string): unknown {
  const board = FAKE_MONDAY_BOARDS.find((entry) => entry.items.some((item) => item.id === itemId))
  const item = board?.items.find((entry) => entry.id === itemId)
  if (!board || !item) {
    return []
  }
  return [
    {
      id: item.id,
      name: item.name,
      url: `https://autrontech.monday.com/boards/${board.id}/pulses/${item.id}`,
      created_at: '2026-09-24T05:58:34Z',
      updated_at: '2026-10-01T04:03:34Z',
      creator: { name: 'Heather' },
      board: { id: board.id, name: board.name },
      group: { title: item.group, color: '#579bfc' },
      description: {
        blocks: [
          {
            type: 'normal_text',
            content: '{"deltaFormat":[{"insert":"串接規格：SSO 走 OIDC，測試環境先行。"}]}'
          }
        ]
      },
      column_values: [
        ...board.columns.map((column) => ({
          ...columnValue(column, item),
          column: { title: column.title }
        })),
        { id: 'link', type: 'link', text: 'https://example.com/spec', column: { title: '連結' } }
      ],
      subitems: [
        { id: '9001', name: '測試環境驗證', column_values: [{ type: 'status', text: 'Done' }] }
      ],
      updates: [
        {
          id: '5001',
          body: '<p>請確認 /en 的導轉規則 <a href="https://example.com/ticket">ticket</a></p><img src="https://autrontech.monday.com/protected_static/1/x.png"><script>window.__mondayXss = true</script>',
          created_at: '2026-09-24T05:59:08.000Z',
          creator: { name: 'Heather' },
          replies: [
            {
              id: '5002',
              body: '<p>已移除路徑快取設定</p>',
              created_at: '2026-09-30T02:58:09.000Z',
              creator: { name: 'Omar' }
            }
          ]
        }
      ]
    }
  ]
}

type GraphqlRequest = { query: string; variables: Record<string, unknown> }

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

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

function respond(request: GraphqlRequest): unknown {
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
    return { items: itemDetail(stringList(variables.ids)[0] ?? '') }
  }
  const data: Record<string, unknown> = {}
  for (let index = 0; Array.isArray(variables[`b${index}`]); index += 1) {
    const board = FAKE_MONDAY_BOARDS.find(
      (entry) => entry.id === stringList(variables[`b${index}`])[0]
    )
    const columnIds = stringList(variables[`c${index}`])
    data[`b${index}`] = board
      ? [{ items_page: itemsPage(board, columnIds, variables[`q${index}`] !== null) }]
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

export type FakeMondayServer = { url: string; tokens: string[]; close: () => Promise<void> }

/** A local stand-in for api.monday.com that answers the queries Orca's monday page sends. */
export async function startFakeMondayServer(): Promise<FakeMondayServer> {
  const tokens: string[] = []
  const server: Server = createServer((request, response) => {
    void readBody(request).then((body) => {
      tokens.push(String(request.headers.authorization ?? ''))
      const data = respond(parseRequest(body))
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
    close: () => new Promise((resolve) => server.close(() => resolve()))
  }
}
