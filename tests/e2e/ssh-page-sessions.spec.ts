import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { createRestartSession } from './helpers/orca-restart'

// Why: mirrors SSH_SESSIONS_WORKTREE_ID in src/shared/local-synthetic-workspace.ts.
// E2E specs avoid importing renderer/shared modules into the Playwright runner.
const SSH_WORKTREE_ID = 'global-ssh-sessions'
// Why: nothing listens on the discard port, so ssh fails fast and never leaves this machine.
const REFUSED_TARGET = {
  label: 'e2e-refused-host',
  host: '127.0.0.1',
  port: 9,
  username: 'nobody'
}

type SshTabSummary = { id: string; label: string | null; ptyId: string | null }

async function addRefusedTarget(page: Page): Promise<void> {
  await page.evaluate(async (target) => {
    await window.api.ssh.addTarget({ target })
  }, REFUSED_TARGET)
}

async function readSshTabs(page: Page): Promise<SshTabSummary[]> {
  return page.evaluate(
    (worktreeId) =>
      (window.__store?.getState().tabsByWorktree[worktreeId] ?? []).map((tab) => ({
        id: tab.id,
        label: tab.quickCommandLabel ?? null,
        ptyId: tab.ptyId
      })),
    SSH_WORKTREE_ID
  )
}

async function readTerminalText(page: Page, tabId: string): Promise<string> {
  return page.evaluate((id) => {
    const panes = window.__paneManagers?.get(id)?.getPanes?.() ?? []
    return panes[0]?.serializeAddon?.serialize?.() ?? ''
  }, tabId)
}

/** Every session asks first and shows the exact ssh command it will type. */
async function confirmSshCommand(page: Page): Promise<void> {
  const dialog = page.locator('[data-command-confirm]')
  await expect(dialog.locator('[data-command-list]')).toContainText('ssh ')
  await dialog.getByRole('button', { name: 'Connect' }).click()
  await expect(dialog).toBeHidden()
}

async function openRefusedSession(page: Page): Promise<SshTabSummary> {
  await page.getByRole('button', { name: 'SSH', exact: true }).click()
  const sshPage = page.locator('[data-ssh-page]')
  await sshPage.locator('[data-ssh-host-row]').filter({ hasText: REFUSED_TARGET.label }).click()
  await confirmSshCommand(page)
  await expect
    .poll(async () => (await readSshTabs(page)).map((tab) => tab.label))
    .toEqual([REFUSED_TARGET.label])
  const [tab] = await readSshTabs(page)
  await expect
    .poll(() => readTerminalText(page, tab.id), { timeout: 20_000 })
    .toContain('Connection refused')
  // Why: the store records the daemon PTY id after the first output, not when the tab opens.
  await expect.poll(async () => (await readSshTabs(page))[0]?.ptyId ?? null).not.toBeNull()
  const [spawned] = await readSshTabs(page)
  expect(spawned.ptyId).toContain(`${SSH_WORKTREE_ID}@@`)
  return spawned
}

test('runs ssh in an SSH page tab that survives leaving the page', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await addRefusedTarget(orcaPage)
  const tab = await openRefusedSession(orcaPage)
  const sshPage = orcaPage.locator('[data-ssh-page]')

  await orcaPage.evaluate(() => window.__store?.getState().setActiveView('terminal'))
  await expect(sshPage).toBeHidden()
  await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
  await expect(sshPage).toBeVisible()

  const [returned] = await readSshTabs(orcaPage)
  expect(returned).toEqual(tab)
  expect(await readTerminalText(orcaPage, tab.id)).toContain('Connection refused')

  await sshPage.getByRole('button', { name: 'New tab' }).click()
  const picker = orcaPage.getByRole('dialog', { name: 'Open an SSH session' })
  await picker.locator('[data-ssh-host-row]').filter({ hasText: REFUSED_TARGET.label }).click()
  await confirmSshCommand(orcaPage)
  await expect(picker).toBeHidden()
  await expect.poll(async () => (await readSshTabs(orcaPage)).length).toBe(2)
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-page-two-sessions.png') })
})

test('restores SSH page tabs after an app restart', async (// oxlint-disable-next-line no-empty-pattern -- This persistence test owns both Electron launches.
{}, testInfo) => {
  test.setTimeout(300_000)
  const session = createRestartSession(testInfo)
  let firstApp: ElectronApplication | null = null
  let secondApp: ElectronApplication | null = null

  try {
    const first = await session.launch()
    firstApp = first.app
    await waitForSessionReady(first.page)
    await addRefusedTarget(first.page)
    await openRefusedSession(first.page)

    await session.close(firstApp)
    firstApp = null

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    await expect
      .poll(async () => (await readSshTabs(second.page)).map((tab) => tab.label))
      .toEqual([REFUSED_TARGET.label])
  } finally {
    for (const app of [secondApp, firstApp]) {
      if (!app) {
        continue
      }
      try {
        await session.close(app)
      } catch {
        // best-effort cleanup
      }
    }
  }
})
