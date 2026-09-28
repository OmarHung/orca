import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpRequest } from '../../shared/database/database-dump-types'
import type { DatabaseError } from '../../shared/database/database-query-types'
import { DatabaseDumpDestinations } from './database-dump-destinations'
import { DatabaseJobService } from './database-job-service'
import { partialDumpPath } from './worker/dump/dump-output'

const dir = mkdtempSync(join(tmpdir(), 'orca-job-service-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const DUMP: DatabaseDumpRequest = {
  objects: [{ kind: 'table', schema: 'main', name: 'people' }],
  options: {
    contents: 'structure-and-data',
    disableForeignKeys: false,
    layout: 'single-file',
    rowsPerInsert: 100,
    dropExisting: false
  }
}

/** A service whose dump request fails with `error` while the session is (or isn't) connected. */
function failingService(error: DatabaseError, connected: boolean) {
  const destinations = new DatabaseDumpDestinations()
  const jobs = new DatabaseJobService({
    destinations,
    sessions: {
      request: async () => ({ ok: false, error }),
      isConnected: () => connected
    }
  })
  return { destinations, jobs }
}

function existingFile(name: string): string {
  const path = join(dir, name)
  writeFileSync(path, 'earlier dump')
  return path
}

const run = (jobs: DatabaseJobService, token: string, dump: DatabaseDumpRequest = DUMP) =>
  jobs.dump({ connectionId: 'c1', jobId: 'job-00000001', token, dump })

describe('DatabaseJobService.dump', () => {
  it('refuses a token that is unknown, used, or chosen for the other layout', async () => {
    const { destinations, jobs } = failingService({ message: 'x' }, true)
    expect(await run(jobs, 'missing')).toMatchObject({ ok: false })

    const file = destinations.register({ kind: 'file', path: join(dir, 'a.sql') })
    const perTable = { ...DUMP, options: { ...DUMP.options, layout: 'file-per-table' as const } }
    expect(await run(jobs, file.token, perTable)).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/expired/) }
    })
    // One use only, even a refused one.
    expect(destinations.take(file.token)).toBeNull()
  })

  it('removes the partial output of a worker that died mid-dump, and keeps the file', async () => {
    const path = existingFile('died.sql')
    const partial = partialDumpPath({ kind: 'file', path }, 'job-00000001')
    const destinations = new DatabaseDumpDestinations()
    const jobs = new DatabaseJobService({
      destinations,
      sessions: {
        request: async () => {
          // The worker had written part of the dump before it died.
          writeFileSync(partial, 'INSERT INTO people VALUES (1);')
          return { ok: false, error: { message: 'Database worker stopped', code: 'unavailable' } }
        },
        isConnected: () => false
      }
    })
    await run(jobs, destinations.register({ kind: 'file', path }).token)
    expect(existsSync(partial)).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('earlier dump')
  })

  it('removes a running dump’s partial output when Orca quits', async () => {
    const path = join(dir, 'quit.sql')
    const partial = partialDumpPath({ kind: 'file', path }, 'job-00000001')
    let finish: () => void = () => undefined
    const destinations = new DatabaseDumpDestinations()
    const jobs = new DatabaseJobService({
      destinations,
      sessions: {
        request: () =>
          new Promise((resolve) => {
            writeFileSync(partial, 'INSERT INTO people VALUES (1);')
            finish = () => resolve({ ok: false, error: { message: 'Database session closed' } })
          }),
        isConnected: () => true
      }
    })
    const running = run(jobs, destinations.register({ kind: 'file', path }).token)
    await new Promise((resolve) => setImmediate(resolve))
    jobs.discardRunning()
    expect(existsSync(partial)).toBe(false)
    finish()
    await running
    // Once the job has ended there is nothing of its left to remove.
    writeFileSync(partial, 'someone else')
    jobs.discardRunning()
    expect(existsSync(partial)).toBe(true)
  })

  it('keeps the file when the worker is alive or the dump never reached it', async () => {
    const alive = failingService({ message: 'relation "people" does not exist' }, true)
    const kept = existingFile('kept.sql')
    await run(alive.jobs, alive.destinations.register({ kind: 'file', path: kept }).token)
    expect(existsSync(kept)).toBe(true)

    const offline = failingService({ message: 'Not connected', code: 'not-connected' }, false)
    const untouched = existingFile('untouched.sql')
    await run(offline.jobs, offline.destinations.register({ kind: 'file', path: untouched }).token)
    expect(existsSync(untouched)).toBe(true)
  })
})
