import {
  addServerConnection,
  explorerMenu,
  openDatabasePage,
  runInConsole
} from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

// Opt-in: a MySQL/MariaDB server without TLS, e.g. `mariadb:10.5 --skip-ssl` (a stock Debian
// package ships that way), as ORCA_TEST_MYSQL_NO_SSL_URL=mysql://root:pw@127.0.0.1:53308/orca_it
const NO_SSL_URL = process.env.ORCA_TEST_MYSQL_NO_SSL_URL

test('connects with SSL "prefer" to a server that has no TLS, as its test did', async ({
  orcaPage
}) => {
  test.skip(!NO_SSL_URL, 'set ORCA_TEST_MYSQL_NO_SSL_URL to a MySQL/MariaDB server without TLS')
  await openDatabasePage(orcaPage)
  await addServerConnection(orcaPage, {
    url: new URL(NO_SSL_URL!),
    type: 'MySQL / MariaDB',
    name: 'no-tls',
    sslMode: 'prefer'
  })
  const row = orcaPage
    .getByRole('tree', { name: 'Database objects' })
    .getByRole('treeitem', { name: /^no-tls/ })
  await explorerMenu(orcaPage, row, 'New Console')
  await runInConsole(orcaPage, 'select 41 + 1 as answer;')
  await expect(
    orcaPage.getByRole('grid').getByRole('gridcell', { name: '42', exact: true })
  ).toBeVisible({ timeout: 30_000 })
  await expect(row).not.toContainText(/Connection (lost|was closed)/)
})
