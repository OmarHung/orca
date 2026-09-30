import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

const WEB_PACKAGE_JSON = JSON.stringify({
  name: 'web',
  private: true,
  scripts: { dev: 'node -e 1', build: 'node -e 1', lint: 'node -e 1' }
})

function ecosystem(page: Page, label: string) {
  return page.getByTestId('run-widget-detected-ecosystem').filter({ hasText: label })
}

function project(page: Page, name: string) {
  return page.getByTestId('run-widget-detected-project').filter({ hasText: name })
}

function kind(page: Page, label: string | RegExp) {
  return page.getByTestId('run-widget-detected-kind').filter({ hasText: label })
}

// Why stepped: Radix keeps a submenu open only while the pointer heads toward it, which a
// single-jump hover never shows.
async function glide(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible()
  const box = await target.boundingBox()
  if (!box) {
    throw new Error('menu entry has no box')
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
}

/** Opens toolchain → project → kind, the way a user reaches a detected run. */
async function openKind(page: Page, path: [string, string, string]): Promise<void> {
  await glide(page, ecosystem(page, path[0]))
  await glide(page, project(page, path[1]))
  await glide(page, kind(page, path[2]))
}

function row(page: Page, label: string) {
  return page.getByTestId('run-widget-item').filter({ hasText: new RegExp(`^${label}$`) })
}

async function openRunMenu(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByTestId('run-configurations-trigger').first().click()
  await expect(page.getByRole('menu').first()).toHaveCSS('opacity', '1')
}

test('nests detected runs by toolchain, project and kind, and hides and shows them again', async ({
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'run-widget-detected')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const web = path.join(fixture.worktreePath, 'apps', 'web')
  const api = path.join(fixture.worktreePath, 'api')
  mkdirSync(web, { recursive: true })
  mkdirSync(api)
  writeFileSync(path.join(web, 'package.json'), WEB_PACKAGE_JSON)
  writeFileSync(
    path.join(api, 'pyproject.toml'),
    '[project]\nname = "api"\n[tool.pytest.ini_options]\n'
  )
  writeFileSync(path.join(api, 'main.py'), 'print("api")\n')

  await waitForSessionReady(orcaPage)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await openRunMenu(orcaPage)

  await expect(ecosystem(orcaPage, 'Python')).toBeVisible({ timeout: 15_000 })
  await openKind(orcaPage, ['Node', 'apps/web', 'Other'])
  await expect(row(orcaPage, 'lint')).toBeVisible()
  await expect(kind(orcaPage, /^(Run|Build|Other)/)).toHaveCount(3)
  await orcaPage.screenshot({ path: testInfo.outputPath('detected-nested-submenus.png') })

  await glide(orcaPage, row(orcaPage, 'lint'))
  await row(orcaPage, 'lint').getByTestId('run-widget-item-hide').click()
  await expect(row(orcaPage, 'lint')).toHaveCount(0)
  await expect(kind(orcaPage, 'Other')).toHaveCount(0)

  await glide(orcaPage, ecosystem(orcaPage, 'Python'))
  await glide(orcaPage, project(orcaPage, 'api'))
  // Why scoped: a closing submenu stays mounted with its own Hide This Project while it fades.
  await orcaPage
    .locator('[data-slot="dropdown-menu-sub-content"]')
    .filter({ has: kind(orcaPage, 'Test') })
    .getByTestId('run-widget-hide-project')
    .click()
  await expect(ecosystem(orcaPage, 'Python')).toHaveCount(0)

  await glide(orcaPage, orcaPage.getByTestId('run-widget-hidden'))
  await expect(orcaPage.getByTestId('run-widget-hidden-item')).toHaveCount(2)
  await orcaPage.screenshot({ path: testInfo.outputPath('detected-hidden-submenu.png') })

  await orcaPage.getByTestId('run-widget-hidden-item').filter({ hasText: 'lint' }).click()
  await expect(orcaPage.getByTestId('run-widget-hidden-item')).toHaveCount(1)
  await openKind(orcaPage, ['Node', 'apps/web', 'Run'])

  // Choosing a detected run makes it the widget's current, recent run.
  await row(orcaPage, 'dev').click()
  await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  await expect(orcaPage.getByTestId('run-configurations-trigger').first()).toHaveText('web: dev')
})
