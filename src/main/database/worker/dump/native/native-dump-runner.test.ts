import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { spawnProcess } from '../../../../../shared/child-process/run-process'
import { DumpOutput } from '../dump-output'
import type { NativeDumpPlan, NativeRun } from './native-dump-plan'
import { NativeDumpRunner } from './native-dump-runner'

const dir = mkdtempSync(join(tmpdir(), 'orca-native-runner-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A run of a fake tool: node running `script`, with `extra` as the tool's own arguments. */
function run(label: string, script: string, extra: string[] = [], tables = 1): NativeRun {
  return { label, args: ['-e', script, '--', ...extra], prelude: `-- ${label}\n`, tables }
}

function plan(
  runs: NativeRun[],
  changes: Partial<NativeDumpPlan> = {},
  onCleanup: () => void = () => undefined
): NativeDumpPlan {
  return {
    tool: {
      kind: 'pg_dump',
      flavor: 'postgres',
      path: process.execPath,
      version: '17',
      problem: null
    },
    env: { ...process.env },
    runs,
    notes: ['a note'],
    withoutTls: null,
    cleanup: async () => onCleanup(),
    ...changes
  }
}

/** Output whose disk fails on the tool's first chunk. */
class FailingOutput extends DumpOutput {
  override async raw(): Promise<void> {
    throw new Error('disk full')
  }
}

const PRINT = (text: string) => `process.stdout.write(${JSON.stringify(text)})`
// Keeps writing until killed.
const ENDLESS = "setInterval(() => process.stdout.write('x'.repeat(65536)), 1)"

describe('NativeDumpRunner', () => {
  it('writes each run’s output after its prelude, a file each for a per-table dump', async () => {
    const folder = join(dir, 'folder')
    const progress: (number | null)[] = []
    const summary = await new NativeDumpRunner({
      plan: plan([
        run('setup', PRINT('CREATE TABLE people;\n'), [], 0),
        run('public.people', PRINT('INSERT INTO people VALUES (1);\n')),
        run(
          'finish',
          `${PRINT('ALTER TABLE people;\n')}; process.stderr.write('warning: odd\\n')`,
          [],
          0
        )
      ]),
      output: new DumpOutput({ kind: 'folder', path: folder }, 'postgres'),
      tableCount: 1,
      onProgress: (next) => progress.push(next.rows),
      isCancelled: () => false
    }).execute()
    expect(readdirSync(folder).sort()).toEqual([
      '000_setup.sql',
      '001_public.people.sql',
      '002_finish.sql'
    ])
    expect(readFileSync(join(folder, '001_public.people.sql'), 'utf8')).toBe(
      '-- public.people\nINSERT INTO people VALUES (1);\n'
    )
    expect(summary).toMatchObject({ cancelled: false, tables: 1, rows: null })
    expect(summary.notes).toEqual(['a note', 'pg_dump: warning: odd'])
    expect(progress.every((rows) => rows === null)).toBe(true)
  })

  it('fails with the tool’s own words, removes what it wrote, and cleans up', async () => {
    const path = join(dir, 'failed.sql')
    let cleaned = 0
    const failing = plan(
      [
        run('one', PRINT('SELECT 1;\n')),
        run(
          'two',
          "process.stderr.write('pg_dump: error: server version mismatch\\n'); process.exit(1)"
        )
      ],
      {},
      () => (cleaned += 1)
    )
    await expect(
      new NativeDumpRunner({
        plan: failing,
        output: new DumpOutput({ kind: 'file', path }, 'postgres'),
        tableCount: 2,
        onProgress: () => undefined,
        isCancelled: () => false
      }).execute()
    ).rejects.toThrow('pg_dump failed: pg_dump: error: server version mismatch')
    expect(existsSync(path)).toBe(false)
    expect(cleaned).toBe(1)
  })

  it('retries without TLS when the plan allows it and nothing was written yet', async () => {
    const path = join(dir, 'retried.sql')
    const tlsFails = `if (process.argv.includes('--ssl')) { process.stderr.write('SSL connection error'); process.exit(2) } ${PRINT('ok;\n')}`
    const summary = await new NativeDumpRunner({
      plan: plan([run('a', tlsFails, ['--ssl']), run('b', tlsFails, ['--ssl'])], {
        withoutTls: (args) => args.map((arg) => (arg === '--ssl' ? '--skip-ssl' : arg))
      }),
      output: new DumpOutput({ kind: 'file', path }, 'mysql'),
      tableCount: 2,
      onProgress: () => undefined,
      isCancelled: () => false
    }).execute()
    expect(summary.cancelled).toBe(false)
    expect(readFileSync(path, 'utf8')).toBe('-- a\nok;\n-- b\nok;\n')
  })

  it('stops a tool that is still writing, whether the cancel is checked or pushed', async () => {
    let cancelled = false
    const checked = join(dir, 'checked.sql')
    const summary = await new NativeDumpRunner({
      plan: plan([run('endless', ENDLESS)]),
      output: new DumpOutput({ kind: 'file', path: checked }, 'postgres'),
      tableCount: 1,
      onProgress: (progress) => {
        cancelled = progress.bytes > 1_000_000
      },
      isCancelled: () => cancelled
    }).execute()
    expect(summary).toMatchObject({ cancelled: true, files: [] })
    expect(existsSync(checked)).toBe(false)

    let stopping = false
    const pushed = join(dir, 'pushed.sql')
    const runner = new NativeDumpRunner({
      plan: plan([run('endless', ENDLESS)]),
      output: new DumpOutput({ kind: 'file', path: pushed }, 'postgres'),
      tableCount: 1,
      onProgress: (progress) => {
        if (progress.bytes > 1_000_000 && !stopping) {
          stopping = true
          runner.cancel()
        }
      },
      isCancelled: () => false
    })
    // A kill the runner wasn't told was a cancel is a failure, not a quiet stop.
    await expect(runner.execute()).rejects.toThrow(/pg_dump failed/)
    expect(existsSync(pushed)).toBe(false)
  })

  it('cleans up the plan (MySQL’s password file) whether it finishes, fails or is cancelled', async () => {
    const cleaned: string[] = []
    const runner = (label: string, script: string, isCancelled: () => boolean) =>
      new NativeDumpRunner({
        plan: plan([run(label, script)], {}, () => cleaned.push(label)),
        output: new DumpOutput({ kind: 'file', path: join(dir, `${label}.sql`) }, 'mysql'),
        tableCount: 1,
        onProgress: () => undefined,
        isCancelled
      }).execute()
    await runner('finished', PRINT('SELECT 1;\n'), () => false)
    await runner('failed', 'process.exit(3)', () => false).catch(() => undefined)
    let bytes = 0
    const cancelled = new NativeDumpRunner({
      plan: plan([run('cancelled', ENDLESS)], {}, () => cleaned.push('cancelled')),
      output: new DumpOutput({ kind: 'file', path: join(dir, 'cancelled.sql') }, 'mysql'),
      tableCount: 1,
      onProgress: (progress) => {
        bytes = progress.bytes
      },
      isCancelled: () => bytes > 1_000_000
    })
    expect(await cancelled.execute()).toMatchObject({ cancelled: true })
    expect(cleaned).toEqual(['finished', 'failed', 'cancelled'])
  })

  it('waits for a tool it stopped to close before cleaning up after an output failure', async () => {
    const events: string[] = []
    let closed: Promise<void> = Promise.resolve()
    // Writes, then takes a while to exit once asked, as a tool flushing its connection would.
    const lingering = `process.on('SIGTERM', () => setTimeout(() => process.exit(0), 400)); ${ENDLESS}`
    const failed = new NativeDumpRunner({
      plan: plan([{ ...run('slow', lingering), prelude: '' }], {}, () => events.push('cleanup')),
      output: new FailingOutput({ kind: 'file', path: join(dir, 'disk-full.sql') }, 'postgres'),
      tableCount: 1,
      onProgress: () => undefined,
      isCancelled: () => false,
      spawn: (spec) => {
        const child = spawnProcess(spec)
        closed = new Promise((resolve) =>
          child.once('close', () => {
            events.push('close')
            resolve()
          })
        )
        return child
      }
    })
      .execute()
      .catch((error: unknown) => events.push(`failed: ${String(error)}`))
    await failed
    await closed
    expect(events).toEqual(['close', 'cleanup', 'failed: Error: disk full'])
  })

  it('leaves the file it would replace as it was when the tool fails partway', async () => {
    const folder = mkdtempSync(join(dir, 'replace-'))
    const path = join(folder, 'shop.sql')
    writeFileSync(path, 'the earlier dump\n')
    await expect(
      new NativeDumpRunner({
        plan: plan([
          run('one', PRINT('CREATE TABLE people (id int);\n')),
          run(
            'two',
            `${PRINT('INSERT INTO')}; process.stderr.write('lost connection'); process.exit(2)`
          )
        ]),
        output: new DumpOutput({ kind: 'file', path }, 'mysql'),
        tableCount: 2,
        onProgress: () => undefined,
        isCancelled: () => false
      }).execute()
    ).rejects.toThrow('lost connection')
    expect(readFileSync(path, 'utf8')).toBe('the earlier dump\n')
    expect(readdirSync(folder)).toEqual(['shop.sql'])
  })
})
