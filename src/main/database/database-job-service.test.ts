import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DatabaseDumpRequest } from '../../shared/database/database-dump-types'
import type { DatabaseError } from '../../shared/database/database-query-types'
import { DatabaseDumpDestinations } from './database-dump-destinations'
import { DatabaseJobService } from './database-job-service'

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

  it('removes what a worker that died mid-dump left behind', async () => {
    const { destinations, jobs } = failingService(
      { message: 'Database worker stopped', code: 'unavailable' },
      false
    )
    const path = existingFile('died.sql')
    await run(jobs, destinations.register({ kind: 'file', path }).token)
    expect(existsSync(path)).toBe(false)
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
