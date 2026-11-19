import Redis from 'ioredis'
import { MongoClient } from 'mongodb'
import type { Page } from '@stablyai/playwright-test'
import {
  explorerMenu,
  openDatabasePage,
  pickConnectionType,
  runInConsole
} from './helpers/database-page'
import { test, expect } from './helpers/orca-app'

// Opt-in per server, with the same URLs as the driver integration tests, e.g.
//   ORCA_TEST_REDIS_URL=redis://127.0.0.1:46379
//   ORCA_TEST_MONGODB_URL=mongodb://orca:pw@127.0.0.1:47017/
const REDIS_URL = process.env.ORCA_TEST_REDIS_URL
const MONGODB_URL = process.env.ORCA_TEST_MONGODB_URL

type NoSqlForm = { type: 'Redis' | 'MongoDB'; name: string; url: URL }

async function addNoSqlConnection(page: Page, form: NoSqlForm): Promise<void> {
  await page.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New Connection' })
  await pickConnectionType(page, form.type)
  await dialog.getByLabel('Name').fill(form.name)
  await dialog.getByLabel('Host').fill(form.url.hostname)
  await dialog.getByLabel('Port').fill(form.url.port)
  if (form.url.username) {
    await dialog.getByLabel('User').fill(decodeURIComponent(form.url.username))
  }
  if (form.url.password) {
    await dialog.getByLabel('Password', { exact: true }).fill(decodeURIComponent(form.url.password))
  }
  await dialog.getByRole('button', { name: 'Test Connection' }).click()
  await expect(dialog.getByText(new RegExp(`^Connected to ${form.type} `))).toBeVisible({
    timeout: 30_000
  })
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
}

test('offers MySQL first and starts a new connection on it', async ({ orcaPage }) => {
  await openDatabasePage(orcaPage)
  await orcaPage.getByRole('button', { name: 'New Connection' }).first().click()
  const dialog = orcaPage.getByRole('dialog', { name: 'New Connection' })
  await expect(dialog.getByLabel('Type')).toHaveText('MySQL / MariaDB')
  await expect(dialog.getByLabel('Port')).toHaveValue('3306')
  await dialog.getByLabel('Type').click()
  await expect(orcaPage.getByRole('option')).toHaveText([
    'MySQL / MariaDB',
    'PostgreSQL',
    'SQL Server',
    'SQLite',
    'MongoDB',
    'Redis'
  ])
})

test.describe('Database page with Redis', () => {
  test.skip(!REDIS_URL, 'set ORCA_TEST_REDIS_URL to a disposable Redis server')

  test('browses keys, opens a hash, runs commands and refuses writes', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(120_000)
    const url = new URL(REDIS_URL!)
    const prefix = `orca-e2e:${Date.now().toString(36)}:`
    const admin = new Redis({
      host: url.hostname,
      port: Number(url.port),
      password: url.password || undefined
    })
    await admin.hset(`${prefix}user`, { name: 'Ada', city: 'London' })
    await admin.set(`${prefix}greeting`, 'hello')
    try {
      await openDatabasePage(orcaPage)
      await addNoSqlConnection(orcaPage, { type: 'Redis', name: 'cache', url })
      const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
      await tree.getByRole('treeitem', { name: /^cache/ }).dblclick()
      await tree.getByRole('treeitem', { name: 'db0', exact: true }).dblclick()
      const key = tree.getByRole('treeitem', { name: new RegExp(`^${prefix}user`) })
      await expect(key).toContainText('hash')
      await key.dblclick()
      const grid = orcaPage.getByRole('grid')
      await expect(grid.getByRole('gridcell', { name: 'London', exact: true })).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.screenshot({ path: testInfo.outputPath('redis-key-view.png') })

      await explorerMenu(orcaPage, tree.getByRole('treeitem', { name: /^cache/ }), 'New Console')
      await runInConsole(orcaPage, `GET ${prefix}greeting`)
      await expect(grid.getByRole('gridcell', { name: 'hello', exact: true })).toBeVisible({
        timeout: 30_000
      })
      await runInConsole(orcaPage, `SET ${prefix}greeting changed`)
      await expect(orcaPage.getByText(/read-only: SET is not on its list/)).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.screenshot({ path: testInfo.outputPath('redis-console.png') })
      expect(await admin.get(`${prefix}greeting`)).toBe('hello')
    } finally {
      await admin.del(`${prefix}user`, `${prefix}greeting`)
      admin.disconnect()
    }
  })
})

test.describe('Database page with MongoDB', () => {
  test.skip(!MONGODB_URL, 'set ORCA_TEST_MONGODB_URL to a disposable MongoDB server')

  test('browses collections, filters a collection and refuses writes', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(120_000)
    const url = new URL(MONGODB_URL!)
    const database = `orca_e2e_${Date.now().toString(36)}`
    const admin = new MongoClient(MONGODB_URL!, { directConnection: true })
    await admin
      .db(database)
      .collection('people')
      .insertMany([
        { name: 'Ada', city: 'London' },
        { name: 'Grace', city: 'Arlington' }
      ])
    try {
      await openDatabasePage(orcaPage)
      await addNoSqlConnection(orcaPage, { type: 'MongoDB', name: 'documents', url })
      const tree = orcaPage.getByRole('tree', { name: 'Database objects' })
      await tree.getByRole('treeitem', { name: /^documents/ }).dblclick()
      await tree.getByRole('treeitem', { name: database, exact: true }).dblclick()
      const people = tree.getByRole('treeitem', { name: 'people', exact: true })
      await people.dblclick()
      const grid = orcaPage.getByRole('grid')
      await expect(grid.getByRole('gridcell', { name: 'Grace', exact: true })).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.getByPlaceholder('e.g. { age: { $gt: 30 } }').fill('city: "London"')
      await orcaPage.keyboard.press('Enter')
      await expect(grid.getByRole('gridcell', { name: 'Grace', exact: true })).toBeHidden({
        timeout: 30_000
      })
      await expect(grid.getByRole('gridcell', { name: 'Ada', exact: true })).toBeVisible()
      await orcaPage.screenshot({ path: testInfo.outputPath('mongodb-collection.png') })

      await explorerMenu(
        orcaPage,
        tree.getByRole('treeitem', { name: database, exact: true }),
        'New Console'
      )
      await runInConsole(orcaPage, 'db.people.countDocuments({})')
      await expect(grid.getByRole('gridcell', { name: '2', exact: true })).toBeVisible({
        timeout: 30_000
      })
      await runInConsole(orcaPage, 'db.people.insertOne({ name: "Mallory" })')
      await expect(orcaPage.getByText(/read-only: insertOne\(\) is not allowed/)).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.screenshot({ path: testInfo.outputPath('mongodb-console.png') })
      expect(await admin.db(database).collection('people').countDocuments()).toBe(2)
    } finally {
      await admin.db(database).dropDatabase()
      await admin.close()
    }
  })
})
