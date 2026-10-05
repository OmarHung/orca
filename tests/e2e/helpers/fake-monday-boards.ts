/** Dates relative to the run day, so the items always land in the month the page opens on. */
export function dayOffset(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export type FakeItem = {
  id: string
  name: string
  group: string
  mine: boolean | null
  status: { label: string; color: string; done: boolean }
  timeline?: [number, number]
  start?: number
  due?: number
}

const IN_PROGRESS = { label: 'In Progress', color: '#fdab3d', done: false }
const DONE = { label: 'Done', color: '#00c875', done: true }
const STUCK = { label: 'Stuck', color: '#df2f4a', done: false }

// Shaped like the real "Project Cases" (timeline + due) and "Omars's Task" (start + due) boards.
export const FAKE_MONDAY_BOARDS = [
  {
    id: '382737576',
    name: 'Project Cases',
    columns: [
      { id: 'person', title: 'Owner', type: 'people' },
      { id: 'date5', title: 'Due Date', type: 'date' },
      { id: 'status8', title: 'Status', type: 'status' },
      { id: 'timeline', title: 'Timeline', type: 'timeline' },
      { id: 'numbers7', title: 'Hrs', type: 'numbers' }
    ],
    items: [
      {
        id: '101',
        name: '海發中心 零信任串接',
        group: '2026年10月維運項目',
        mine: true,
        status: IN_PROGRESS,
        timeline: [-1, 4],
        due: 2
      },
      {
        id: '102',
        name: '拜爾 排程自動刪除報告',
        group: '2026年10月維運項目',
        mine: true,
        status: IN_PROGRESS,
        timeline: [3, 3],
        due: 8
      },
      {
        id: '103',
        name: '兆利 HTML 上稿',
        group: '兆利 HTML上稿及動態資料開發',
        mine: true,
        status: STUCK,
        timeline: [-10, -3],
        due: -3
      },
      {
        id: '104',
        name: 'FC 阻擋異常確認',
        group: '2026年10月維運項目',
        mine: true,
        status: DONE,
        timeline: [-6, -5],
        due: -5
      },
      {
        id: '105',
        name: 'Posidog 選項擴充',
        group: 'Posidog 客製化商品選項擴充',
        mine: null,
        status: IN_PROGRESS,
        due: 12
      },
      {
        id: '106',
        name: 'Vivian 的設計稿',
        group: '澳康電商官網',
        mine: false,
        status: IN_PROGRESS,
        timeline: [0, 2],
        due: 2
      }
    ] satisfies FakeItem[]
  },
  {
    id: '7961752624',
    name: "Omars's Task",
    columns: [
      { id: 'multiple_person_mkq95a24', title: '使用者', type: 'people' },
      { id: 'date__1', title: '開始日期', type: 'date' },
      { id: 'date4', title: 'Due Date', type: 'date' },
      { id: 'status', title: 'Status', type: 'status' }
    ],
    items: [
      {
        id: '201',
        name: 'FC SEO 欄位開發建置',
        group: 'FC SEO&官網調整',
        mine: true,
        status: IN_PROGRESS,
        start: -2,
        due: 5
      },
      {
        id: '202',
        name: '週報整理',
        group: 'This Week',
        mine: null,
        status: IN_PROGRESS,
        start: 1
      },
      { id: '203', name: '嬉書 金流付款期限', group: 'Tasks', mine: null, status: IN_PROGRESS }
    ] satisfies FakeItem[]
  }
]

/** The "Web CRM" record a Project Cases task links to, shaped like the real board's columns. */
export const FAKE_WEB_CRM_RELATION = {
  id: 'board_relation_mm394pb1',
  type: 'board_relation',
  text: null,
  display_value: '海發中心 官網',
  column: { title: 'Web CRM' },
  linked_items: [
    {
      id: '3070049341',
      name: '海發中心 官網',
      url: 'https://autrontech.monday.com/boards/414475727/pulses/3070049341',
      board: { name: 'Web CRM' },
      column_values: [
        { id: 'person', type: 'people', text: 'Heather海瑟', column: { title: 'PM Manager' } },
        {
          id: 'status',
          type: 'status',
          text: 'Online',
          label_style: { color: '#00c875' },
          column: { title: '上線狀態Status' }
        },
        {
          id: 'text',
          type: 'text',
          text: 'https://www.example.org/',
          column: { title: 'Website' }
        },
        { id: 'text0', type: 'text', text: '34.81.133.222', column: { title: 'IP' } },
        {
          id: 'status7',
          type: 'status',
          text: 'p2-web-server-apple',
          label_style: { color: '#00c875' },
          column: { title: '伺服器位置Server' }
        },
        { id: 'date9', type: 'date', text: '2027-09-19', column: { title: '到期日Expire Date' } },
        {
          id: 'board_relation_mm39rrra',
          type: 'board_relation',
          text: null,
          column: { title: 'link to Project Cases' }
        }
      ]
    }
  ]
}
