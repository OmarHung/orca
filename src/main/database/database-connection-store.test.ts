import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseConnectionDraft } from '../../shared/database/database-connection-types'
import { DatabaseConnectionStore } from './database-connection-store'

const draft: DatabaseConnectionDraft = {
  driver: 'postgres',
  name: 'Local',
  host: 'localhost',
  port: 5432,
  database: 'app',
  user: 'dev',
  sslMode: 'prefer',
  readOnly: false,
  passwordStorage: 'forever'
}

describe('DatabaseConnectionStore', () => {
  let dir: string
  let filePath: string
  let clock: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-db-store-'))
    filePath = join(dir, 'connections.json')
    clock = 1_000
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const createStore = (): DatabaseConnectionStore =>
    new DatabaseConnectionStore(filePath, () => clock)

  it('creates, updates and deletes connections', () => {
    const store = createStore()
    const created = store.save(undefined, draft)
    expect(created).toMatchObject({ ...draft, createdAt: 1_000, updatedAt: 1_000 })

    clock = 2_000
    const updated = store.save(created.id, { ...draft, name: 'Renamed' })
    expect(updated).toMatchObject({
      id: created.id,
      name: 'Renamed',
      createdAt: 1_000,
      updatedAt: 2_000
    })
    expect(createStore().list()).toHaveLength(1)

    store.delete(created.id)
    expect(createStore().list()).toEqual([])
  })

  it('never writes a password field', () => {
    createStore().save(undefined, draft)
    expect(readFileSync(filePath, 'utf8')).not.toMatch(/password"\s*:/i)
  })

  it('skips invalid entries instead of dropping the whole file', () => {
    const valid = createStore().save(undefined, draft)
    const file = JSON.parse(readFileSync(filePath, 'utf8'))
    file.connections.push({ id: 'bad', driver: 'oracle' })
    writeFileSync(filePath, JSON.stringify(file))
    expect(
      createStore()
        .list()
        .map((connection) => connection.id)
    ).toEqual([valid.id])
  })

  it('reads a corrupt file as empty', () => {
    writeFileSync(filePath, '{not json')
    expect(createStore().list()).toEqual([])
  })
})
