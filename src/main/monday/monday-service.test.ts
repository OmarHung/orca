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
      { id: 'person', title: 'Owner', type: 'people', text: 'Alice, Omar' }
    ])
    expect(detail.descriptionText).toBe('規格說明')
    expect(detail.subitems).toEqual([{ id: '5', name: 'Sub', statusText: 'Done' }])
    expect(detail.updates[0]).toMatchObject({ creatorName: 'Alice', bodyHtml: '<p>請確認</p>' })
    expect(detail.updates[0].replies[0]).toMatchObject({ creatorName: 'Omar', bodyHtml: '好' })
  })
})
