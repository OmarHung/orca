import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { MondayService } from './monday-service'
import { MondayApiError } from './monday-graphql-client'
import { createFakeMondayGraphql } from './monday-graphql-test-harness'

const ME = {
  id: '30000001',
  name: 'Omar',
  email: 'omar@example.com',
  account: { slug: 'acme', name: 'Acme' }
}

function secretStore(canSeal: boolean): SecretStore {
  return {
    isEncryptionAvailable: () => canSeal,
    encryptString: (text) => Buffer.from(`sealed:${text}`),
    decryptString: (cipher) => cipher.toString().replace(/^sealed:/, ''),
    describeProtectionGap: () => (canSeal ? null : 'no keychain')
  }
}

let dataDir: string

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'orca-monday-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('MondayService', () => {
  it('checks the token with monday, then seals it', async () => {
    const graphql = createFakeMondayGraphql(() => ({ me: ME }))
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    const status = await service.connect('secret-token')

    expect(status.account).toMatchObject({ userId: '30000001', accountSlug: 'acme' })
    expect(status.tokenKeptForSessionOnly).toBe(false)
    expect(readFileSync(join(dataDir, 'token.json'), 'utf8')).not.toContain('secret-token')
    const reopened = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    expect(reopened.status().account?.userName).toBe('Omar')
  })

  it('keeps the token in memory only when there is no keychain', async () => {
    const graphql = createFakeMondayGraphql(() => ({ me: ME }))
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(false),
      graphql: graphql.call
    })
    const status = await service.connect('secret-token')
    expect(status.tokenKeptForSessionOnly).toBe(true)
    expect(status.account).not.toBeNull()
    const reopened = new MondayService({
      dataDir,
      secretStore: () => secretStore(false),
      graphql: graphql.call
    })
    expect(reopened.status().account).toBeNull()
  })

  it('does not keep a rejected token', async () => {
    const graphql = createFakeMondayGraphql(() => {
      throw new MondayApiError('unauthorized', 'The monday token was rejected.')
    })
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await expect(service.connect('bad')).rejects.toThrow('rejected')
    expect(service.status().account).toBeNull()
  })

  it('refuses API calls before connecting and forgets the token on disconnect', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {') ? { me: ME } : { boards: [] }
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await expect(service.listBoards()).rejects.toMatchObject({ kind: 'not-connected' })
    await service.connect('secret-token')
    await expect(service.listBoards()).resolves.toEqual([])
    expect(graphql.mock.mock.calls.at(-1)?.[0]).toBe('secret-token')
    expect(service.disconnect().account).toBeNull()
    await expect(service.listBoards()).rejects.toMatchObject({ kind: 'not-connected' })
  })

  it('lists only real boards', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            boards: [
              {
                id: '1000000001',
                name: 'Client Projects',
                type: 'board',
                workspace: { name: 'Main workspace' }
              },
              {
                id: '1000000004',
                name: '團隊文件',
                type: 'document',
                workspace: { name: 'Main workspace' }
              }
            ]
          }
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await service.connect('secret-token')
    await expect(service.listBoards()).resolves.toEqual([
      { id: '1000000001', name: 'Client Projects', workspaceName: 'Main workspace' }
    ])
  })

  it('lists assignable people once per connection', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            users: [
              {
                id: '30000001',
                name: 'Omar',
                email: 'o@example.com',
                kind: 'guest',
                status: 'ACTIVE',
                is_deleted: false
              },
              {
                id: '30000002',
                name: 'Alice愛麗絲',
                email: 'h@example.com',
                kind: 'admin',
                status: 'ACTIVE',
                is_deleted: false
              },
              {
                id: '1',
                name: 'Gone',
                email: 'g@example.com',
                kind: 'member',
                status: 'ACTIVE',
                is_deleted: true
              },
              {
                id: '2',
                name: 'Off',
                email: 'x@example.com',
                kind: 'member',
                status: 'INACTIVE',
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
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await service.connect('secret-token')
    await expect(service.listUsers()).resolves.toEqual([
      { id: '30000001', name: 'Omar', email: 'o@example.com' },
      { id: '30000002', name: 'Alice愛麗絲', email: 'h@example.com' }
    ])
    await service.listUsers()
    expect(graphql.mock).toHaveBeenCalledTimes(2)
  })

  it("reads each board's last-change time in one call", async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            boards: [
              { id: '1000000001', updated_at: '2026-10-05T09:04:03Z' },
              { id: '1000000003', updated_at: null }
            ]
          }
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await service.connect('secret-token')
    await expect(service.boardsUpdatedAt(['1000000001', '1000000003'])).resolves.toEqual({
      '1000000001': '2026-10-05T09:04:03Z',
      '1000000003': ''
    })
    expect(graphql.mock.mock.calls.at(-1)?.[2]).toEqual({ ids: ['1000000001', '1000000003'] })
  })

  it('maps item details with updates, replies and subitems', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            items: [
              {
                id: '2000000001',
                name: '登入錯誤排查',
                url: 'https://acme.monday.com/boards/1000000001/pulses/2000000001',
                created_at: '2026-09-24T05:58:34Z',
                updated_at: '2026-10-01T04:03:34Z',
                creator: { name: 'Alice' },
                board: { id: '1000000001', name: 'Client Projects' },
                group: { title: '十月例行工作', color: '#00c875' },
                description: {
                  blocks: [
                    { type: 'normal_text', content: '{"deltaFormat":[{"insert":"規格說明"}]}' }
                  ]
                },
                column_values: [
                  { id: 'subitems', type: 'subtasks', text: null, column: { title: 'Subitems' } },
                  {
                    id: 'person',
                    type: 'people',
                    text: 'Alice, Omar',
                    column: { title: 'Owner' }
                  },
                  { id: 'numbers7', type: 'numbers', text: '', column: { title: 'Hrs' } }
                ],
                subitems: [
                  { id: '5', name: 'Sub', column_values: [{ type: 'status', text: 'Done' }] }
                ],
                updates: [
                  {
                    id: '1',
                    body: '<p>請確認</p>',
                    created_at: '2026-09-24T05:59:08.000Z',
                    creator: { name: 'Alice' },
                    replies: [{ id: '2', body: '好', created_at: null, creator: { name: 'Omar' } }]
                  }
                ]
              }
            ]
          }
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await service.connect('secret-token')
    const detail = await service.getItem('2000000001')
    expect(detail.columns).toEqual([
      { id: 'person', title: 'Owner', type: 'people', text: 'Alice, Omar', color: null }
    ])
    expect(detail.descriptionText).toBe('規格說明')
    expect(detail.subitems).toEqual([{ id: '5', name: 'Sub', statusText: 'Done' }])
    expect(detail.updates[0]).toMatchObject({ creatorName: 'Alice', bodyHtml: '<p>請確認</p>' })
    expect(detail.updates[0].replies[0]).toMatchObject({ creatorName: 'Omar', bodyHtml: '好' })
  })

  it('falls back to display values for links it cannot expand and mirror columns', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            items: [
              {
                id: '2000000002',
                name: '活動頁製作',
                url: 'https://acme.monday.com/boards/1000000001/pulses/2000000002',
                created_at: null,
                updated_at: null,
                creator: null,
                board: { id: '1000000001', name: 'Client Projects' },
                group: null,
                description: null,
                column_values: [
                  {
                    id: 'board_relation_aaaa1111',
                    type: 'board_relation',
                    text: null,
                    display_value: '範例股份有限公司',
                    column: { title: 'Client CRM' }
                  },
                  {
                    id: 'mirror',
                    type: 'mirror',
                    text: null,
                    display_value: '',
                    column: { title: 'Client' }
                  }
                ],
                subitems: null,
                updates: null
              }
            ]
          }
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await service.connect('secret-token')
    const detail = await service.getItem('2000000002')
    expect(detail.columns).toEqual([
      {
        id: 'board_relation_aaaa1111',
        title: 'Client CRM',
        type: 'board_relation',
        text: '範例股份有限公司',
        color: null
      }
    ])
    expect(detail.relations).toEqual([])
    const itemQuery = graphql.mock.mock.calls
      .map((call) => call[1])
      .find((query) => query.includes('items('))
    expect(itemQuery).toContain('linked_items')
    expect(itemQuery).toContain('... on MirrorValue { display_value }')
    expect(itemQuery).toContain('... on DependencyValue { display_value }')
  })

  it('expands linked items into cards without their links back', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            items: [
              {
                id: '2000000003',
                name: '彈窗功能',
                url: 'https://acme.monday.com/boards/1000000001/pulses/2000000003',
                created_at: null,
                updated_at: null,
                creator: null,
                board: { id: '1000000001', name: 'Client Projects' },
                group: null,
                description: null,
                column_values: [
                  {
                    id: 'board_relation_aaaa1111',
                    type: 'board_relation',
                    text: null,
                    display_value: '範例網站',
                    column: { title: 'Client CRM' },
                    linked_items: [
                      {
                        id: '2000000004',
                        name: '範例網站',
                        url: 'https://acme.monday.com/boards/1000000002/pulses/2000000004',
                        board: { name: 'Client CRM' },
                        column_values: [
                          {
                            id: 'subitems',
                            type: 'subtasks',
                            text: null,
                            column: { title: 'Subitems' }
                          },
                          {
                            id: 'status',
                            type: 'status',
                            text: 'Online',
                            label_style: { color: '#00c875' },
                            column: { title: '上線狀態' }
                          },
                          {
                            id: 'text',
                            type: 'text',
                            text: 'https://www.example.com/',
                            column: { title: 'Website' }
                          },
                          {
                            id: 'text0',
                            type: 'text',
                            text: '203.0.113.20',
                            column: { title: 'IP' }
                          },
                          { id: 'text3', type: 'text', text: '', column: { title: '備註' } },
                          {
                            id: 'board_relation_bbbb2222',
                            type: 'board_relation',
                            text: null,
                            display_value: '彈窗功能',
                            column: { title: 'link to Client Projects' }
                          }
                        ]
                      }
                    ]
                  }
                ],
                subitems: null,
                updates: null
              }
            ]
          }
    )
    const service = new MondayService({
      dataDir,
      secretStore: () => secretStore(true),
      graphql: graphql.call
    })
    await service.connect('secret-token')
    const detail = await service.getItem('2000000003')
    expect(detail.columns).toEqual([])
    expect(detail.relations).toEqual([
      {
        columnId: 'board_relation_aaaa1111',
        title: 'Client CRM',
        items: [
          {
            id: '2000000004',
            name: '範例網站',
            url: 'https://acme.monday.com/boards/1000000002/pulses/2000000004',
            boardName: 'Client CRM',
            columns: [
              {
                id: 'status',
                title: '上線狀態',
                type: 'status',
                text: 'Online',
                color: '#00c875'
              },
              {
                id: 'text',
                title: 'Website',
                type: 'text',
                text: 'https://www.example.com/',
                color: null
              },
              { id: 'text0', title: 'IP', type: 'text', text: '203.0.113.20', color: null }
            ]
          }
        ]
      }
    ])
  })
})
