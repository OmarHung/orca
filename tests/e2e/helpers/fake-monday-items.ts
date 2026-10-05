import {
  dayOffset,
  FAKE_MONDAY_BOARDS,
  FAKE_WEB_CRM_RELATION,
  type FakeItem
} from './fake-monday-boards'

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function peopleText(item: FakeItem): string {
  return item.mine === null ? '' : item.mine ? 'Omar' : 'Vivian'
}

export function columnValue(
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

export const OMAR_ID = '69175796'
export const VIVIAN_ID = '63803784'

export type PersonFilter = { personId: string; includeUnassigned: boolean } | null

/** Reads the `person-<id>` rule (plus optional `is_empty`) Orca sends as query_params. */
export function personFilter(params: unknown): PersonFilter {
  if (
    !params ||
    typeof params !== 'object' ||
    !('rules' in params) ||
    !Array.isArray(params.rules)
  ) {
    return null
  }
  const values = params.rules.flatMap((rule: unknown) =>
    rule && typeof rule === 'object' && 'compare_value' in rule
      ? stringList(rule.compare_value)
      : []
  )
  const person = values.find((value) => value.startsWith('person-'))
  return person
    ? { personId: person.slice('person-'.length), includeUnassigned: params.rules.length > 1 }
    : null
}

function ownerId(item: FakeItem): string | null {
  return item.mine === null ? null : item.mine ? OMAR_ID : VIVIAN_ID
}

/** Item names changed during a test, by item id. */
export type FakeItemNames = ReadonlyMap<string, string>

export function itemsPage(
  board: (typeof FAKE_MONDAY_BOARDS)[number],
  columnIds: string[],
  filter: PersonFilter,
  names: FakeItemNames
): unknown {
  const columns = board.columns.filter((column) => columnIds.includes(column.id))
  const items = board.items.filter((item) => {
    const owner = ownerId(item)
    return !filter || owner === filter.personId || (owner === null && filter.includeUnassigned)
  })
  return {
    cursor: null,
    items: items.map((item) => ({
      id: item.id,
      name: names.get(item.id) ?? item.name,
      url: `https://autrontech.monday.com/boards/${board.id}/pulses/${item.id}`,
      group: { title: item.group, color: '#579bfc' },
      column_values: columns.map((column) => columnValue(column, item))
    }))
  }
}

export function itemDetail(itemId: string, names: FakeItemNames): unknown {
  const board = FAKE_MONDAY_BOARDS.find((entry) => entry.items.some((item) => item.id === itemId))
  const item = board?.items.find((entry) => entry.id === itemId)
  if (!board || !item) {
    return []
  }
  return [
    {
      id: item.id,
      name: names.get(item.id) ?? item.name,
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
        { id: 'link', type: 'link', text: 'https://example.com/spec', column: { title: '連結' } },
        ...(board.id === '382737576' ? [FAKE_WEB_CRM_RELATION] : [])
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
            },
            {
              id: '5003',
              body: '<p>@Omar 第三點 FC工程師回覆<br>Gcp load balancer 本身就會自動合併多條斜線</p>',
              created_at: '2026-10-01T05:33:00.000Z',
              creator: { name: 'Heather海瑟' }
            },
            {
              id: '5004',
              body: '<p>那就要請他們做之前說要確認的這個</p>',
              created_at: '2026-10-01T09:34:00.000Z',
              creator: { name: 'Omar' }
            }
          ]
        }
      ]
    }
  ]
}
