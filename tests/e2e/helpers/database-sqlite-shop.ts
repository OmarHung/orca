import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** A throwaway SQLite file with a small `people` table, removed after Electron shuts down. */
export function seedShopDatabase(cleanup: (fn: () => Promise<void>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'orca-e2e-sqlite-'))
  cleanup(async () => rmSync(dir, { recursive: true, force: true }))
  const filePath = join(dir, 'shop.db')
  const seed = new DatabaseSync(filePath)
  seed.exec(
    `create table people (id integer primary key, name text not null, profile text);
     insert into people values (1, 'Ada', '{"lang":"en","tags":["math"]}'), (2, 'Bob', null), (3, 'Cy', null)`
  )
  seed.close()
  return filePath
}

/** Expands `shop.db` › `main` in the explorer and returns the `people` row. */
export async function expandPeople(page: Page): Promise<Locator> {
  const tree = page.getByRole('tree', { name: 'Database objects' })
  await tree.getByRole('treeitem', { name: 'shop.db' }).dblclick()
  await tree.getByRole('treeitem', { name: 'main' }).dblclick()
  const people = tree.getByRole('treeitem', { name: 'people' })
  await expect(people).toBeVisible({ timeout: 20_000 })
  return people
}
