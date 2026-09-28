import { runAdminSql } from '../../../src/main/database/worker/database-test-admin'
import { serverConnectionFromUrl } from '../../../src/main/database/worker/database-worker-test-harness'

// Orca's database tools are read-only, so e2e fixtures are written straight through the drivers.

type ServerDriver = Parameters<typeof serverConnectionFromUrl>[0]

// Why string keys: a URL's protocol can be anything, and an unknown one must miss, not fail to type.
const DRIVERS: ReadonlyMap<string, ServerDriver> = new Map<string, ServerDriver>([
  ['postgres:', 'postgres'],
  ['mysql:', 'mysql'],
  ['sqlserver:', 'sqlserver']
])

/** Runs `statements` on a writable connection to the server behind a test URL. */
export async function adminSql(
  url: URL | string,
  statements: string[],
  options: { database?: string; ignoreErrors?: boolean } = {}
): Promise<void> {
  const parsed = new URL(url)
  const driver = DRIVERS.get(parsed.protocol)
  if (!driver) {
    throw new Error(`no test driver for ${parsed.protocol}`)
  }
  await runAdminSql(serverConnectionFromUrl(driver, parsed.toString()), statements, options)
}

/** Runs `statements` on a SQLite file, which the app opens read-only. */
export async function adminSqlite(filePath: string, statements: string[]): Promise<void> {
  await runAdminSql(
    { connection: { driver: 'sqlite', name: 'e2e fixture', filePath }, password: null },
    statements
  )
}
