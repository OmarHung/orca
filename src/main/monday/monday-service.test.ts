import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import { MondayService } from './monday-service'
import { MondayApiError } from './monday-graphql-client'
import { createFakeMondayGraphql } from './monday-graphql-test-harness'

const ME = {
  id: '69175796',
  name: 'Omar',
  email: 'omar@example.com',
  account: { slug: 'autrontech', name: 'Autron' }
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

    expect(status.account).toMatchObject({ userId: '69175796', accountSlug: 'autrontech' })
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
                id: '382737576',
                name: 'Project Cases',
                type: 'board',
                workspace: { name: 'Main workspace' }
              },
              {
                id: '9847013437',
                name: '遠端連線方式',
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
      { id: '382737576', name: 'Project Cases', workspaceName: 'Main workspace' }
    ])
  })

  it('lists assignable people once per connection', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            users: [
              {
                id: '69175796',
                name: 'Omar',
                email: 'o@example.com',
                kind: 'guest',
                status: 'ACTIVE',
                is_deleted: false
              },
              {
                id: '28766460',
                name: 'Heather海瑟',
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
                id: '117170086',
                name: 'Aurora',
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
      { id: '69175796', name: 'Omar', email: 'o@example.com' },
      { id: '28766460', name: 'Heather海瑟', email: 'h@example.com' }
    ])
    await service.listUsers()
    expect(graphql.mock).toHaveBeenCalledTimes(2)
  })

  it('maps item details with updates, replies and subitems', async () => {
    const graphql = createFakeMondayGraphql((query) =>
      query.includes('me {')
        ? { me: ME }
        : {
            items: [
              {
                id: '13123057182',
                name: 'FC 阻擋異常確認',
                url: 'https://autrontech.monday.com/boards/382737576/pulses/13123057182',
                created_at: '2026-09-24T05:58:34Z',
                updated_at: '2026-10-01T04:03:34Z',
                creator: { name: 'Heather' },
                board: { id: '382737576', name: 'Project Cases' },
                group: { title: '2026年10月維運項目', color: '#00c875' },
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
                    text: 'Heather, Omar',
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
                    creator: { name: 'Heather' },
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
    const detail = await service.getItem('13123057182')
    expect(detail.columns).toEqual([
      { id: 'person', title: 'Owner', type: 'people', text: 'Heather, Omar' }
    ])
    expect(detail.descriptionText).toBe('規格說明')
    expect(detail.subitems).toEqual([{ id: '5', name: 'Sub', statusText: 'Done' }])
    expect(detail.updates[0]).toMatchObject({ creatorName: 'Heather', bodyHtml: '<p>請確認</p>' })
    expect(detail.updates[0].replies[0]).toMatchObject({ creatorName: 'Omar', bodyHtml: '好' })
  })
})
