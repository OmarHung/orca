import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'

// The default `pnpm test` runs with no database server URLs. Every database integration test
// must still be collected there and skip what needs a server, instead of failing while its
// suites are declared (e.g. by parsing an unset URL). A separate Vitest run shows that.

const SERVER_URLS = /^ORCA_TEST_(POSTGRES|MYSQL|MARIADB|SQLSERVER)_URL$/
const dir = mkdtempSync(join(tmpdir(), 'orca-db-collection-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

type Report = {
  numFailedTestSuites: number
  numFailedTests: number
  testResults: { name: string; status: string; assertionResults: { status: string }[] }[]
}

function isReport(value: unknown): value is Report {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(Reflect.get(value, 'testResults')) &&
    typeof Reflect.get(value, 'numFailedTests') === 'number'
  )
}

it('collects every database integration test without server URLs, skipping what needs one', async () => {
  const files = readdirSync(join('src', 'main', 'database'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.integration.test.ts'))
    .map((file) => join('src', 'main', 'database', file))
  const output = join(dir, 'report.json')
  const result = await runProcess({
    program: process.execPath,
    args: [
      join('node_modules', 'vitest', 'vitest.mjs'),
      'run',
      '--config',
      join('config', 'vitest.config.ts'),
      '--reporter=json',
      `--outputFile=${output}`,
      ...files
    ],
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !SERVER_URLS.test(key) && !key.startsWith('VITEST')
      )
    ),
    timeoutMs: 240_000
  })
  const report: unknown = JSON.parse(readFileSync(output, 'utf8'))
  if (!isReport(report)) {
    throw new Error(`Unexpected Vitest report:\n${result.stdout}\n${result.stderr}`)
  }
  expect(report.testResults.map((file) => file.name).length).toBe(files.length)
  expect(
    report.testResults.filter((file) => file.status === 'failed').map((file) => file.name)
  ).toEqual([])
  expect(report).toMatchObject({ numFailedTestSuites: 0, numFailedTests: 0 })
  const pgDump = report.testResults.find((file) =>
    file.name.endsWith('postgres-native-dump.integration.test.ts')
  )
  expect(pgDump?.assertionResults.length).toBeGreaterThan(0)
  expect(pgDump?.assertionResults.every((test) => test.status !== 'passed')).toBe(true)
  expect(result.code).toBe(0)
}, 300_000)
