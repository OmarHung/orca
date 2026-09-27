import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpRequest } from '../../../shared/database/database-dump-types'
import { createWorkerHarness, expectOk } from './database-worker-test-harness'

const dir = mkdtempSync(join(tmpdir(), 'orca-worker-jobs-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const filePath = join(dir, 'shop.db')
const seed = new DatabaseSync(filePath)
seed.exec(`
  create table people (id integer primary key, name text);
  with recursive n(i) as (select 1 union all select i + 1 from n where i < 50000)
  insert into people select i, 'person ' || i from n;
`)
seed.close()

const REQUEST: DatabaseDumpRequest = {
  objects: [{ kind: 'table', schema: 'main', name: 'people' }],
  options: {
    contents: 'structure-and-data',
    disableForeignKeys: false,
    layout: 'single-file',
    rowsPerInsert: 1000,
    dropExisting: false
  }
}

async function connected() {
  const harness = createWorkerHarness()
  await expectOk(
    harness.send({
      type: 'connect',
      connection: { driver: 'sqlite', name: 'shop', filePath },
      password: null
    })
  )
  return harness
}

describe('worker dump jobs', () => {
  it('writes the dump, reporting progress as it goes', async () => {
    const harness = await connected()
    const path = join(dir, 'all.sql')
    const summary = await expectOk(
      harness.send({
        type: 'dump',
        jobId: 'job-all-0001',
        request: REQUEST,
        destination: { kind: 'file', path }
      })
    )
    expect(summary).toMatchObject({ cancelled: false, files: [path], tables: 1, rows: 50000 })
    expect(readFileSync(path, 'utf8')).toMatch(/INSERT INTO people/)
    expect(harness.progress.at(-1)).toMatchObject({ kind: 'dump', tablesDone: 1, rows: 50000 })
    expect(await expectOk(harness.send({ type: 'cancelJob', jobId: 'job-all-0001' }))).toEqual({
      cancelled: false
    })
    await harness.send({ type: 'close' })
  })

  it('stops a job it is asked to cancel, leaving no file behind', async () => {
    const harness = await connected()
    const path = join(dir, 'cancelled.sql')
    const running = harness.send({
      type: 'dump',
      jobId: 'job-cancel-01',
      request: { ...REQUEST, options: { ...REQUEST.options, rowsPerInsert: 1 } },
      destination: { kind: 'file', path }
    })
    expect(await expectOk(harness.send({ type: 'cancelJob', jobId: 'job-cancel-01' }))).toEqual({
      cancelled: true
    })
    expect(await expectOk(running)).toMatchObject({ cancelled: true, files: [] })
    expect(existsSync(path)).toBe(false)
    await harness.send({ type: 'close' })
  })

  it('cancels running jobs before closing, so a disconnect leaves no half dump', async () => {
    const harness = await connected()
    const path = join(dir, 'closed.sql')
    const running = harness.send({
      type: 'dump',
      jobId: 'job-close-001',
      request: { ...REQUEST, options: { ...REQUEST.options, rowsPerInsert: 1 } },
      destination: { kind: 'file', path }
    })
    await expectOk(harness.send({ type: 'close' }))
    expect(await expectOk(running)).toMatchObject({ cancelled: true })
    expect(existsSync(path)).toBe(false)
  })
})
