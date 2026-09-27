import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createWorkerHarness,
  expectOk,
  onlyRows,
  serverConnectionFromUrl
} from './database-worker-test-harness'

// Opt-in: servers without TLS, which `prefer` must fall back from. ORCA_TEST_MYSQL_NO_SSL_URL is
// e.g. mariadb started with --skip-ssl (like a stock Debian package); a Homebrew PostgreSQL at
// ORCA_TEST_POSTGRES_URL has ssl off.

const SERVERS = [
  { driver: 'mysql', url: process.env.ORCA_TEST_MYSQL_NO_SSL_URL },
  { driver: 'postgres', url: process.env.ORCA_TEST_POSTGRES_URL }
] as const

describe.each(SERVERS)('$driver SSL prefer', ({ driver, url }) => {
  it.skipIf(!url)(
    'connects in plaintext without reporting the refused TLS attempt as a lost connection',
    async () => {
      const harness = createWorkerHarness()
      const { connection, password } = serverConnectionFromUrl(driver, url!)
      if (connection.driver !== 'mysql' && connection.driver !== 'postgres') {
        throw new Error(`no prefer mode for ${connection.driver}`)
      }
      try {
        await expectOk(
          harness.send({
            type: 'connect',
            connection: { ...connection, sslMode: 'prefer' },
            password
          })
        )
        const result = await expectOk(
          harness.send({
            type: 'execute',
            consoleId: randomUUID(),
            sql: 'select 1 as one',
            pageSize: 10
          })
        )
        expect(onlyRows(result).rows).toEqual([['1']])
        // Why wait: a stray error from the abandoned TLS attempt would arrive after the handshake.
        await new Promise((resolve) => setTimeout(resolve, 200))
        expect(harness.lost).toEqual([])
      } finally {
        await harness.send({ type: 'close' })
      }
    }
  )
})
