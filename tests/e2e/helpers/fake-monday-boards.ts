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

// Shaped like the real "Client Projects" (timeline + due) and "Personal Tasks" (start + due) boards.
export const FAKE_MONDAY_BOARDS = [
  {
    id: '1000000001',
    name: 'Client Projects',
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
        name: '首頁改版',
        group: '十月例行工作',
        mine: true,
        status: IN_PROGRESS,
        timeline: [-1, 4],
        due: 2
      },
      {
        id: '102',
        name: '月報匯出',
        group: '十月例行工作',
        mine: true,
        status: IN_PROGRESS,
        timeline: [3, 3],
        due: 8
      },
      {
        id: '103',
        name: '活動頁製作',
        group: '活動頁專案',
        mine: true,
        status: STUCK,
        timeline: [-10, -3],
        due: -3
      },
      {
        id: '104',
        name: '登入錯誤排查',
        group: '十月例行工作',
        mine: true,
        status: DONE,
        timeline: [-6, -5],
        due: -5
      },
      {
        id: '105',
        name: '購物車調整',
        group: '購物車專案',
        mine: null,
        status: IN_PROGRESS,
        due: 12
      },
      {
        id: '106',
        name: 'Bella 的設計稿',
        group: '設計稿專案',
        mine: false,
        status: IN_PROGRESS,
        timeline: [0, 2],
        due: 2
      }
    ] satisfies FakeItem[]
  },
  {
    id: '1000000003',
    name: "Personal Tasks",
    columns: [
      { id: 'multiple_person_cccc3333', title: '使用者', type: 'people' },
      { id: 'date__1', title: '開始日期', type: 'date' },
      { id: 'date4', title: 'Due Date', type: 'date' },
      { id: 'status', title: 'Status', type: 'status' }
    ],
    items: [
      {
        id: '201',
        name: 'SEO 欄位調整',
        group: 'SEO 專案',
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
      { id: '203', name: '付款流程確認', group: 'Tasks', mine: null, status: IN_PROGRESS }
    ] satisfies FakeItem[]
  }
]
