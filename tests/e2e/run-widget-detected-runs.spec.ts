import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
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

function project(page: Page, name: string) {
  return page.getByTestId('run-widget-detected-project').filter({ hasText: name })
}

/** The open project submenu that lists `runName`; a closing one stays mounted while it fades. */
function submenuWith(page: Page, runName: string) {
  return page.locator('[data-slot="dropdown-menu-sub-content"]').filter({ has: row(page, runName) })
}

function row(page: Page, label: string) {
  return page.getByTestId('run-widget-item').filter({ hasText: new RegExp(`^${label}$`) })
}

async function openRunMenu(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toHaveCount(0)
  await page.getByTestId('run-configurations-trigger').first().click()
  await expect(page.getByRole('menu').first()).toHaveCSS('opacity', '1')
}

test('lists detected runs per project by kind, and hides and shows them again', async ({
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

  await expect(project(orcaPage, 'api')).toBeVisible({ timeout: 15_000 })
  await project(orcaPage, 'apps/web').hover()
  await expect(row(orcaPage, 'lint')).toBeVisible()
  await expect(
    submenuWith(orcaPage, 'lint').locator('[data-slot="dropdown-menu-label"]')
  ).toHaveCount(3)
  await orcaPage.screenshot({ path: testInfo.outputPath('detected-web-submenu.png') })

  await row(orcaPage, 'lint').hover()
  await row(orcaPage, 'lint').getByTestId('run-widget-item-hide').click()
  await expect(row(orcaPage, 'lint')).toHaveCount(0)
  await expect(row(orcaPage, 'dev')).toBeVisible()

  await project(orcaPage, 'api').hover()
  await submenuWith(orcaPage, 'main.py').getByTestId('run-widget-hide-project').click()
  await expect(project(orcaPage, 'api')).toHaveCount(0)

  await orcaPage.getByTestId('run-widget-hidden').hover()
  await expect(orcaPage.getByTestId('run-widget-hidden-item')).toHaveCount(2)
  await orcaPage.screenshot({ path: testInfo.outputPath('detected-hidden-submenu.png') })

  await orcaPage.getByTestId('run-widget-hidden-item').filter({ hasText: 'lint' }).click()
  await expect(orcaPage.getByTestId('run-widget-hidden-item')).toHaveCount(1)
  await project(orcaPage, 'apps/web').hover()
  await expect(row(orcaPage, 'lint')).toBeVisible()

  // Choosing a detected run makes it the widget's current, recent run.
  await row(orcaPage, 'dev').click()
  await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  await expect(orcaPage.getByTestId('run-configurations-trigger').first()).toHaveText('web: dev')
})
