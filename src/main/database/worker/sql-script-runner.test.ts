import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { DatabaseScriptOptions } from '../../../shared/database/database-script-types'
import type { DatabaseTransactionState } from '../../../shared/database/database-query-types'
import { runSqlScript, type SqlScriptFileSource } from './sql-script-runner'

const dir = mkdtempSync(join(tmpdir(), 'orca-sql-script-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function scriptFile(name: string, text: string): SqlScriptFileSource {
  const path = join(dir, name)
  writeFileSync(path, text)
  return { path, name, size: Buffer.byteLength(text) }
}

const AUTO: DatabaseScriptOptions = { onError: 'stop', transaction: false }

/** A fake session: `boom` fails, BEGIN/COMMIT/ROLLBACK move its transaction. */
function fakeSession(options: { manual?: boolean; onRun?: (sql: string) => void } = {}) {
  const ran: string[] = []
  let transaction: DatabaseTransactionState = 'none'
  const runStatement = async (sql: string): Promise<DatabaseTransactionState> => {
    ran.push(sql)
    options.onRun?.(sql)
    if (/^(commit|rollback)$/i.test(sql)) {
      transaction = 'none'
      return transaction
    }
    if (options.manual || /^begin/i.test(sql)) {
      transaction = 'open'
    }
    if (sql.includes('boom')) {
      throw new Error(`failed: ${sql}`)
    }
    return transaction
  }
  return { ran, runStatement }
}

function run(
  files: SqlScriptFileSource[],
  session: ReturnType<typeof fakeSession>,
  options: DatabaseScriptOptions = AUTO,
  extra: { isCancelled?: () => boolean; chunkBytes?: number } = {}
) {
  const progress: number[] = []
  const summary = runSqlScript({
    files,
    dialect: 'postgres',
    options,
    runStatement: session.runStatement,
    describeError: (error) => ({ message: String(error), cancelled: false }),
    onProgress: (report) => progress.push(report.bytesDone),
    isCancelled: extra.isCancelled ?? (() => false),
    chunkBytes: extra.chunkBytes ?? 7
  })
  return { summary, progress }
}

describe('runSqlScript', () => {
  it('runs a streamed file statement by statement, stopping at the first failure', async () => {
    const bom = String.fromCharCode(0xfeff)
    const file = scriptFile('a.sql', `${bom}select 1;\n\nselect\n  2;\nselect boom;\nselect 3;\n`)
    const session = fakeSession()
    const { summary, progress } = run([file], session)
    expect(await summary).toMatchObject({
      statements: 2,
      failed: 1,
      cancelled: false,
      failures: [{ file: 'a.sql', line: 5, statement: 'select boom' }],
      transaction: null
    })
    expect(session.ran).toEqual(['select 1', 'select\n  2', 'select boom'])
    expect(progress.at(-1)).toBe(file.size)
  })

  it('keeps going past failures when asked, counting each', async () => {
    const file = scriptFile('b.sql', 'select boom1;\nselect 1;\nselect boom2;\nselect 2')
    const session = fakeSession()
    const summary = await run([file], session, { onError: 'continue', transaction: false }).summary
    expect(summary).toMatchObject({ statements: 2, failed: 2 })
    expect(summary.failures.map((failure) => failure.line)).toEqual([1, 3])
  })

  it('runs files in the order given, on one session', async () => {
    const files = [scriptFile('001.sql', 'select 1;'), scriptFile('002.sql', 'select 2;')]
    const session = fakeSession()
    expect(await run(files, session).summary).toMatchObject({ statements: 2 })
    expect(session.ran).toEqual(['select 1', 'select 2'])
  })

  it('commits the run’s transaction at the end, or rolls it back after a failure', async () => {
    const ok = fakeSession({ manual: true })
    const inOne: DatabaseScriptOptions = { onError: 'continue', transaction: true }
    const committed = await run([scriptFile('c.sql', 'insert 1;\ninsert 2;')], ok, inOne).summary
    expect(committed.transaction).toBe('committed')
    expect(ok.ran.at(-1)).toBe('COMMIT')

    const failing = fakeSession({ manual: true })
    const rolledBack = await run(
      [scriptFile('d.sql', 'insert 1;\ninsert boom;\ninsert 3;')],
      failing,
      inOne
    ).summary
    // A transaction stops at its first failure even when told to continue.
    expect(failing.ran).toEqual(['insert 1', 'insert boom', 'ROLLBACK'])
    expect(rolledBack).toMatchObject({ failed: 1, transaction: 'rolled-back' })
  })

  it('rolls back a transaction the script opened and never ended', async () => {
    const session = fakeSession()
    const summary = await run([scriptFile('e.sql', 'begin;\ninsert 1;')], session).summary
    expect(summary.transaction).toBe('rolled-back')
    expect(session.ran.at(-1)).toBe('ROLLBACK')
  })

  it('stops between statements once cancelled', async () => {
    let cancelled = false
    const session = fakeSession({ onRun: (sql) => (cancelled ||= sql === 'select 2') })
    const summary = await run(
      [scriptFile('f.sql', 'select 1;\nselect 2;\nselect 3;\n'), scriptFile('g.sql', 'select 4;')],
      session,
      AUTO,
      { isCancelled: () => cancelled }
    ).summary
    expect(summary).toMatchObject({ cancelled: true, statements: 2 })
    expect(session.ran).toEqual(['select 1', 'select 2'])
  })

  it('reports a statement too long to hold, and a file it cannot read, as failures', async () => {
    const unclosed = scriptFile(
      'h.sql',
      `select 1;\nselect '${'x'.repeat(40)}\n${'y'.repeat(40)}\n`
    )
    const session = fakeSession()
    const summary = await runSqlScript({
      files: [unclosed, { path: join(dir, 'missing.sql'), name: 'missing.sql', size: 0 }],
      dialect: 'postgres',
      options: { onError: 'continue', transaction: false },
      runStatement: session.runStatement,
      describeError: (error) => ({ message: String(error), cancelled: false }),
      onProgress: () => undefined,
      isCancelled: () => false,
      chunkBytes: 16,
      maxPendingChars: 30
    })
    expect(session.ran).toEqual(['select 1'])
    expect(summary.failures).toMatchObject([
      { file: 'h.sql', line: 2, message: expect.stringMatching(/longer than 64 MB/) },
      { file: 'missing.sql', line: 0, message: expect.stringMatching(/ENOENT/) }
    ])
  })
})
