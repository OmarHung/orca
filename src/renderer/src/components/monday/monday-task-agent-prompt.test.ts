// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { LINKED_CONTEXT_BLOCK_MAX_CHARS } from '@/lib/linked-work-item-context'
import type {
  MondayBoardSchedule,
  MondayItemDetail,
  MondayUpdate
} from '../../../../shared/monday/monday-types'
import type { MondayCalendarEntry } from './monday-calendar-model'
import { buildMondayTaskAgentPrompt } from './monday-task-agent-prompt'

function update(id: string, createdAt: string, bodyHtml: string): MondayUpdate {
  return { id, creatorName: 'Cora', createdAt, bodyHtml, replies: [] }
}

const detail: MondayItemDetail = {
  id: '42',
  name: '範例任務',
  url: 'https://acme.monday.com/boards/1/pulses/42',
  boardId: '1',
  boardName: 'Client Projects',
  groupTitle: '示範客戶',
  groupColor: null,
  creatorName: null,
  createdAt: null,
  updatedAt: null,
  columns: [
    { id: 'status', title: 'Status', type: 'status', text: 'Working on it', color: '#fdab3d' },
    { id: 'link', title: '連結', type: 'link', text: 'https://shop.example.com/p/1', color: null },
    { id: 'empty', title: 'Notes', type: 'text', text: '', color: null }
  ],
  relations: [
    {
      columnId: 'crm',
      title: 'Client CRM',
      items: [
        {
          id: '7',
          name: '示範客戶',
          url: 'https://acme.monday.com/boards/9/pulses/7',
          boardName: 'Client CRM',
          columns: [
            {
              id: 'site',
              title: 'Website',
              type: 'link',
              text: 'https://shop.example.com',
              color: null
            },
            { id: 'pw', title: 'Admin password', type: 'text', text: 'hunter2', color: null }
          ]
        }
      ]
    }
  ],
  descriptionText: null,
  subitems: [{ id: '5', name: '檢查頁面', statusText: 'Done' }],
  updates: [
    update('u1', '2026-10-01T09:00:00Z', '<p>older</p>'),
    update('u2', '2026-10-08T09:41:00Z', '<p>選單沒有顯示</p>')
  ]
}

const board: MondayBoardSchedule = {
  boardId: '1',
  boardName: 'Client Projects',
  roles: {
    statusColumnId: 'status',
    priorityColumnId: null,
    peopleColumnId: null,
    timelineColumnId: null,
    startDateColumnId: null,
    dueDateColumnId: null
  },
  roleTitles: {},
  items: [],
  truncated: false,
  updatedAt: null
}

const entry: MondayCalendarEntry = {
  boardName: 'Client Projects',
  item: {
    id: '42',
    boardId: '1',
    name: '範例任務',
    url: detail.url,
    groupTitle: '示範客戶',
    groupColor: null,
    status: { label: 'Working on it', color: '#fdab3d', isDone: false },
    priority: null,
    peopleText: 'Cora, Alice',
    timeline: null,
    startDate: null,
    dueDate: '2026-10-16'
  },
  schedule: { span: null, spanSource: null, due: '2026-10-16', overdue: false, dueBeforeEnd: false }
}

describe('buildMondayTaskAgentPrompt', () => {
  it('lists the fields once, with schedule roles taken from the entry', () => {
    const prompt = buildMondayTaskAgentPrompt({ detail, entry, board })

    expect(prompt).toContain('Task: 範例任務')
    expect(prompt).toContain('Board: Client Projects · 示範客戶')
    expect(prompt).toContain(`monday link: ${detail.url}`)
    expect(prompt).toContain('Due date: 2026-10-16')
    expect(prompt).toContain('People: Cora, Alice')
    expect(prompt).toContain('連結: https://shop.example.com/p/1')
    expect(prompt.match(/Working on it/g)).toHaveLength(1)
    expect(prompt).not.toContain('Notes:')
    expect(prompt).toContain('- 檢查頁面 (Done)')
  })

  it('lists every column when the task is not on the schedule', () => {
    const prompt = buildMondayTaskAgentPrompt({ detail, entry: null, board })

    expect(prompt).toContain('Status: Working on it')
    expect(prompt).not.toContain('Due date:')
  })

  it('gives linked records only their links', () => {
    const prompt = buildMondayTaskAgentPrompt({ detail, entry, board })

    expect(prompt).toContain(
      'Client CRM: 示範客戶 https://acme.monday.com/boards/9/pulses/7 https://shop.example.com'
    )
    expect(prompt).not.toContain('hunter2')
  })

  it('puts the newest update first', () => {
    const prompt = buildMondayTaskAgentPrompt({ detail, entry, board })

    expect(prompt.indexOf('選單沒有顯示')).toBeLessThan(prompt.indexOf('older'))
  })

  it('drops terminal control and bidi characters from other people’s text', () => {
    const prompt = buildMondayTaskAgentPrompt({
      detail: { ...detail, descriptionText: 'a\u001b[201~b‮c\td\r\ne' },
      entry,
      board
    })

    expect(prompt).toContain('a[201~bc  d\ne')
  })

  it('caps the length and says where the rest is', () => {
    const long = update('u3', '2026-10-09T00:00:00Z', `<p>${'x'.repeat(20_000)}</p>`)
    const prompt = buildMondayTaskAgentPrompt({
      detail: { ...detail, updates: [...detail.updates, long] },
      entry,
      board
    })

    expect(prompt.length).toBeLessThanOrEqual(LINKED_CONTEXT_BLOCK_MAX_CHARS)
    expect(prompt.startsWith('Please work on this monday task:')).toBe(true)
    expect(prompt.endsWith('The monday link above has everything.]')).toBe(true)
  })
})
