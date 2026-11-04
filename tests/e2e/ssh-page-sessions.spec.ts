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
  // Why exact: this host's port and user only reach ssh when the command spells them out.
  await expect(dialog.locator('[data-command-list]')).toContainText('ssh -p 9 nobody@127.0.0.1')
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

test('a files tab runs no ssh until asked, and going back to the host reuses it', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await addRefusedTarget(orcaPage)
  await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
  const sshPage = orcaPage.locator('[data-ssh-page]')
  const hostRow = sshPage.locator('[data-ssh-host-row]').filter({ hasText: REFUSED_TARGET.label })
  await hostRow.click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Open a files tab' }).click()
  await expect.poll(async () => (await readSshTabs(orcaPage)).length).toBe(1)

  // Files only: the terminal area is hidden, and nothing has run.
  await expect(sshPage.locator('[data-remote-files]')).toBeVisible()
  await expect(sshPage.locator('[data-remote-terminals]')).toBeHidden()
  const [filesTab] = await readSshTabs(orcaPage)
  expect(filesTab.ptyId).toBeNull()

  // Clicking the host goes to this tab instead of asking to open another.
  await hostRow.click()
  await expect(orcaPage.locator('[data-command-confirm]')).toBeHidden()
  expect(await readSshTabs(orcaPage)).toHaveLength(1)

  // The terminal half waits for the user; switching to it still runs nothing.
  await sshPage.locator('[data-remote-layout="terminal"]').click()
  const connect = sshPage.getByRole('button', { name: `Connect to ${REFUSED_TARGET.label}` })
  await expect(connect).toBeVisible()
  expect((await readSshTabs(orcaPage))[0].ptyId).toBeNull()
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-terminal-not-started.png') })

  // Connecting confirms the exact command and runs it in this same tab.
  await connect.click()
  await confirmSshCommand(orcaPage)
  await expect
    .poll(() => readTerminalText(orcaPage, filesTab.id), { timeout: 20_000 })
    .toContain('Connection refused')
  expect((await readSshTabs(orcaPage)).map((tab) => tab.id)).toEqual([filesTab.id])

  // Once it has shown files, the tab outlives its shell and can connect again.
  await sshPage.locator('[data-remote-layout="split"]').click()
  // Why wait: the layout switch hands focus to the terminal a couple of frames later.
  await expect(sshPage.locator('[data-remote-terminals] textarea')).toBeFocused()
  await orcaPage.keyboard.type('exit\n')
  await expect(connect).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await readSshTabs(orcaPage))[0]?.ptyId ?? null).toBeNull()
  expect((await readSshTabs(orcaPage)).map((tab) => tab.id)).toEqual([filesTab.id])
  await expect(sshPage.locator('[data-remote-files]')).toBeVisible()
  await connect.click()
  await confirmSshCommand(orcaPage)
  await expect.poll(async () => (await readSshTabs(orcaPage))[0]?.ptyId ?? null).not.toBeNull()
})

test('says when ssh is over, and reconnects in the same tab over a half-typed line', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await addRefusedTarget(orcaPage)
  const tab = await openRefusedSession(orcaPage)
  const sshPage = orcaPage.locator('[data-ssh-page]')

  // The refused ssh left a local shell behind, under a tab named after the host.
  const banner = sshPage.locator('[data-ssh-session-ended]')
  await expect(banner).toContainText(`not ${REFUSED_TARGET.label}`, { timeout: 30_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('ssh-session-ended.png') })

  // A script under a shell of the same name is not a prompt: reconnecting must not interrupt it.
  await sshPage.locator('[data-remote-terminals] .xterm').click()
  await expect(sshPage.locator('[data-remote-terminals] textarea')).toBeFocused()
  await orcaPage.keyboard.type("bash -c 'read line; echo still-$((40+2))'\n")
  await expect(banner.getByRole('button', { name: 'Reconnect' })).toBeEnabled()
  await banner.getByRole('button', { name: 'Reconnect' }).click()
  await confirmSshCommand(orcaPage)
  await expect(
    orcaPage.getByText('Something still seems to be running in this tab. Finish it first.').last()
  ).toBeVisible()
  await sshPage.locator('[data-remote-terminals] .xterm').click()
  await expect(sshPage.locator('[data-remote-terminals] textarea')).toBeFocused()
  await orcaPage.keyboard.press('Enter')
  // Only a script that was never interrupted gets as far as printing this.
  await expect.poll(() => readTerminalText(orcaPage, tab.id)).toContain('still-42')
  const afterScript = await readTerminalText(orcaPage, tab.id)
  expect(afterScript.split('Connection refused').length - 1).toBe(1)

  // Text left at the prompt must not end up in front of the ssh command.
  await sshPage.locator('[data-remote-terminals] .xterm').click()
  await expect(sshPage.locator('[data-remote-terminals] textarea')).toBeFocused()
  await orcaPage.keyboard.type('echo leftover')
  await expect.poll(() => readTerminalText(orcaPage, tab.id)).toContain('echo leftover')
  await banner.getByRole('button', { name: 'Reconnect' }).click()
  await confirmSshCommand(orcaPage)

  await expect
    .poll(async () => {
      const text = await readTerminalText(orcaPage, tab.id)
      return text.split('Connection refused').length - 1
    })
    .toBe(2)
  const text = await readTerminalText(orcaPage, tab.id)
  expect(text).not.toContain('echo leftoverssh')
  expect(text).not.toContain('leftover ssh')
  expect((await readSshTabs(orcaPage)).map((row) => row.id)).toEqual([tab.id])
})

test('restores SSH page tabs after an app restart', async (// oxlint-disable-next-line no-empty-pattern -- This persistence test owns both Electron launches.
{}, testInfo) => {
  // Launches Orca twice, and each launch opens a session before the restart can be checked.
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
    const hostRow = first.page
      .locator('[data-ssh-page] [data-ssh-host-row]')
      .filter({ hasText: REFUSED_TARGET.label })
    await hostRow.click({ button: 'right' })
    await first.page.getByRole('menuitem', { name: 'Open a files tab' }).click()
    await expect.poll(async () => (await readSshTabs(first.page)).length).toBe(2)

    await session.close(firstApp)
    firstApp = null

    const second = await session.launch()
    secondApp = second.app
    await waitForSessionReady(second.page)
    await expect
      .poll(async () => (await readSshTabs(second.page)).map((tab) => tab.label))
      .toEqual([REFUSED_TARGET.label, REFUSED_TARGET.label])
    // The files tab comes back as one: still no terminal, on the page that shows it.
    await second.page.getByRole('button', { name: 'SSH', exact: true }).click()
    const sshPage = second.page.locator('[data-ssh-page]')
    await expect(sshPage.locator('[data-remote-files]')).toBeVisible()
    await expect(sshPage.locator('[data-remote-terminals]')).toBeHidden()
    expect((await readSshTabs(second.page))[1].ptyId).toBeNull()
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
