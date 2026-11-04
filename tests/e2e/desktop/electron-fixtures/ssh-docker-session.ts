import type { Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import type { DockerSshHostTarget } from './docker-ssh-host-target'

export async function readTerminalText(page: Page, tabId: string): Promise<string> {
  return page.evaluate(
    (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.serializeAddon?.serialize?.() ?? '',
    tabId
  )
}

export function terminalCell(page: Page, tabId: string): ReturnType<Page['locator']> {
  return page.locator(`[data-remote-terminal-cell="${tabId}"]`)
}

export async function focusTerminalCell(page: Page, tabId: string): Promise<void> {
  await terminalCell(page, tabId).locator('.xterm').click()
  await expect(terminalCell(page, tabId).locator('textarea')).toBeFocused()
}

export async function focusActiveTerminal(page: Page): Promise<void> {
  const active = page.locator('[data-ssh-page] [data-remote-terminal-cell][data-active]')
  await active.locator('.xterm').click()
  await expect(active.locator('textarea')).toBeFocused()
}

/** Call before the SSH page opens: its host list loads when the page becomes visible. */
export async function addDockerTarget(
  page: Page,
  target: DockerSshHostTarget,
  name: string
): Promise<string> {
  const label = `${name} ${Date.now()}`
  await page.evaluate(
    async ({ host, port, identityFile, label: hostLabel }) => {
      await window.api.ssh.addTarget({
        target: {
          label: hostLabel,
          host,
          port,
          username: 'root',
          identityFile,
          identitiesOnly: true
        }
      })
    },
    { host: target.host, port: target.port, identityFile: target.identityFile, label }
  )
  return label
}

export function readSessionTabId(page: Page, label: string): Promise<string> {
  return page.evaluate(
    (tabLabel) =>
      window.__store
        ?.getState()
        .tabsByWorktree['global-ssh-sessions']?.find(
          (tab) => tab.ptyId && tab.quickCommandLabel === tabLabel
        )?.id ?? '',
    label
  )
}

/** The typed ssh has no key flag, so log in by hand to reach a real remote shell in the tab. */
export async function connectDockerTab(
  page: Page,
  target: DockerSshHostTarget,
  label: string
): Promise<string> {
  await page.getByRole('button', { name: 'SSH', exact: true }).click()
  const sshPage = page.locator('[data-ssh-page]')
  await sshPage.locator('[data-remote-side-tab="hosts"]').click()
  await sshPage.locator('[data-ssh-host-row]').filter({ hasText: label }).click()
  const connect = page.locator('[data-command-confirm]')
  await connect.getByRole('button', { name: 'Connect' }).click()
  await expect(connect).toBeHidden()
  await expect.poll(() => readSessionTabId(page, label)).not.toBe('')
  const tabId = await readSessionTabId(page, label)
  await expect
    .poll(() => readTerminalText(page, tabId), { timeout: 30_000 })
    .toMatch(/yes\/no|password/i)
  const terminals = sshPage.locator('[data-remote-terminals]')
  await expect(terminals).toHaveAttribute('data-ssh-liveness', 'connected')
  await focusActiveTerminal(page)
  await page.keyboard.press('Control+c')
  await expect(sshPage.locator('[data-ssh-session-ended]')).toBeVisible()
  await page.keyboard.type(
    `ssh -i '${target.identityFile}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${target.port} root@${target.host}\n`
  )
  await expect(sshPage.locator('[data-ssh-session-ended]')).toBeHidden()
  await page.keyboard.type('echo remote-$((40+2))\n')
  await expect.poll(() => readTerminalText(page, tabId), { timeout: 30_000 }).toContain('remote-42')
  await expect(terminals).toHaveAttribute('data-ssh-liveness', 'connected')
  return tabId
}
