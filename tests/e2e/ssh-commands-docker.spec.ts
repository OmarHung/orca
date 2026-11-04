import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshHostTarget,
  execDockerSshHostTargetCommand,
  startDockerSshHostTarget,
  type DockerSshHostTarget
} from './helpers/docker-ssh-host-target'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const REMOTE_OUTPUT = '/tmp/orca-command-output'
const REMOTE_MARKER = '/tmp/orca-command-injected'
// Each piece would create the marker file if the value ever left its quotes.
const HOSTILE_VALUE = `a b; touch ${REMOTE_MARKER}; $(touch ${REMOTE_MARKER}) \`touch ${REMOTE_MARKER}\` ' " done`

async function readTerminalText(page: Page, tabId: string): Promise<string> {
  return page.evaluate(
    (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.serializeAddon?.serialize?.() ?? '',
    tabId
  )
}

async function focusTerminal(page: Page): Promise<void> {
  const sshPage = page.locator('[data-ssh-page]')
  await sshPage.locator('[data-remote-terminals] .xterm').filter({ visible: true }).click()
  await expect(sshPage.locator('[data-remote-terminals] textarea')).toBeFocused()
}

/** The typed ssh has no key flag, so log in by hand to reach a real remote shell in the tab. */
async function connectTab(page: Page, target: DockerSshHostTarget): Promise<string> {
  const label = `Docker commands E2E ${Date.now()}`
  await page.evaluate(
    async ({ host, port, identityFile, label: name }) => {
      await window.api.ssh.addTarget({
        target: { label: name, host, port, username: 'root', identityFile, identitiesOnly: true }
      })
    },
    { host: target.host, port: target.port, identityFile: target.identityFile, label }
  )
  await page.getByRole('button', { name: 'SSH', exact: true }).click()
  const sshPage = page.locator('[data-ssh-page]')
  await sshPage.locator('[data-ssh-host-row]').filter({ hasText: label }).click()
  const connect = page.locator('[data-command-confirm]')
  await connect.getByRole('button', { name: 'Connect' }).click()
  await expect(connect).toBeHidden()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__store?.getState().tabsByWorktree['global-ssh-sessions']?.find((tab) => tab.ptyId)
            ?.id ?? ''
      )
    )
    .not.toBe('')
  const tabId = await page.evaluate(
    () =>
      window.__store?.getState().tabsByWorktree['global-ssh-sessions']?.find((tab) => tab.ptyId)
        ?.id ?? ''
  )
  await expect
    .poll(() => readTerminalText(page, tabId), { timeout: 30_000 })
    .toMatch(/yes\/no|password/i)
  const terminals = sshPage.locator('[data-remote-terminals]')
  await expect(terminals).toHaveAttribute('data-ssh-liveness', 'connected')
  await focusTerminal(page)
  await page.keyboard.press('Control+c')
  await expect(sshPage.locator('[data-ssh-session-ended]')).toBeVisible()
  await page.keyboard.type(
    `ssh -i '${target.identityFile}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${target.port} root@${target.host}\n`
  )
  await expect(sshPage.locator('[data-ssh-session-ended]')).toBeHidden()
  await page.keyboard.type('echo remote-$((40+2))\n')
  await expect.poll(() => readTerminalText(page, tabId), { timeout: 30_000 }).toContain('remote-42')
  await expect(sshPage.locator('[data-remote-terminals]')).toHaveAttribute(
    'data-ssh-liveness',
    'connected'
  )
  return tabId
}

async function addCommand(page: Page, name: string, template: string): Promise<void> {
  await page.locator('[data-ssh-command-action="new"]').click()
  const dialog = page.locator('[data-ssh-command-edit-dialog]')
  await dialog.locator('#ssh-command-name').fill(name)
  await dialog.locator('#ssh-command-template').fill(template)
  await dialog.locator('[data-ssh-command-save]').click()
  await expect(dialog).toBeHidden()
}

function commandRow(page: Page, name: string): ReturnType<Page['locator']> {
  return page.locator('[data-ssh-command-row]').filter({ hasText: name }).locator('button').first()
}

function remoteFileExists(target: DockerSshHostTarget, path: string): boolean {
  return execDockerSshHostTargetCommand(target, `test -e ${path} && echo yes || echo no`) === 'yes'
}

test.describe('SSH page commands against a Docker sshd', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')

  test('fills in a command safely, and refuses to type anywhere but the remote shell', async ({
    orcaPage
  }, testInfo) => {
    // Starts a Docker sshd and logs in, then runs each command and checks the result on the server.
    test.setTimeout(180_000)
    let target: DockerSshHostTarget | null = null
    try {
      target = startDockerSshHostTarget(testInfo)
      await waitForSessionReady(orcaPage)
      const dockerTarget = target
      const tabId = await connectTab(orcaPage, dockerTarget)
      await orcaPage.locator('[data-remote-side-tab="commands"]').click()
      await expect(orcaPage.locator('[data-ssh-command-list]')).toBeVisible()

      await addCommand(orcaPage, 'Write a value', `printf %s {{word}} > ${REMOTE_OUTPUT}`)
      await addCommand(orcaPage, 'Paste only', 'echo pasted-$((1+1))')
      await orcaPage.screenshot({ path: testInfo.outputPath('ssh-commands-list.png') })

      // A hostile value reaches the server as one string, and runs nothing.
      await commandRow(orcaPage, 'Write a value').click()
      const runDialog = orcaPage.locator('[data-ssh-command-run-dialog]')
      await runDialog.locator('[data-ssh-command-param="word"] input').fill(HOSTILE_VALUE)
      await expect(runDialog.locator('[data-command-list]')).toContainText('printf %s ')
      await orcaPage.screenshot({ path: testInfo.outputPath('ssh-commands-run.png') })
      await runDialog.locator('[data-ssh-command-run]').click()
      await expect(runDialog).toBeHidden()
      await expect
        .poll(() => execDockerSshHostTargetCommand(dockerTarget, `cat ${REMOTE_OUTPUT} || true`))
        .toBe(HOSTILE_VALUE)
      expect(remoteFileExists(dockerTarget, REMOTE_MARKER)).toBe(false)

      // This tab's ssh was started by hand, so even a plain paste shows the host doubt first.
      await commandRow(orcaPage, 'Paste only').click()
      await expect(runDialog.locator('[data-ssh-command-doubt="manualSsh"]')).toBeVisible()
      await runDialog.locator('[data-ssh-command-insert]').click()
      await expect(runDialog).toBeHidden()
      await expect.poll(() => readTerminalText(orcaPage, tabId)).toContain('echo pasted-$((1+1))')
      expect(await readTerminalText(orcaPage, tabId)).not.toContain('pasted-2')
      await focusTerminal(orcaPage)
      await orcaPage.keyboard.press('Enter')
      await expect.poll(() => readTerminalText(orcaPage, tabId)).toContain('pasted-2')

      // A full-screen program would read the text as keystrokes, so nothing is offered.
      await orcaPage.keyboard.type(`printf '\\033[?1049h'; read line; printf '\\033[?1049l'\n`)
      await expect
        .poll(() =>
          orcaPage.evaluate(
            (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.terminal.buffer.active.type,
            tabId
          )
        )
        .toBe('alternate')
      await commandRow(orcaPage, 'Write a value').click()
      await expect(runDialog.locator('[data-ssh-command-blocked]')).toContainText('full-screen')
      await expect(runDialog.locator('[data-ssh-command-run]')).toBeDisabled()
      await runDialog.getByRole('button', { name: 'Cancel' }).click()
      await focusTerminal(orcaPage)
      await orcaPage.keyboard.press('Enter')

      // Once ssh ends, the same command would run on this computer, so it is refused.
      await orcaPage.keyboard.type('exit\n')
      await expect(orcaPage.locator('[data-ssh-session-ended]')).toBeVisible({ timeout: 30_000 })
      await commandRow(orcaPage, 'Write a value').click()
      await expect(runDialog.locator('[data-ssh-command-blocked]')).toContainText(
        'back on your computer'
      )
      await expect(runDialog.locator('[data-ssh-command-run]')).toBeDisabled()
      await expect(runDialog.locator('[data-ssh-command-insert]')).toBeDisabled()
      await orcaPage.screenshot({ path: testInfo.outputPath('ssh-commands-refused.png') })
      await runDialog.getByRole('button', { name: 'Cancel' }).click()

      const textBefore = await readTerminalText(orcaPage, tabId)
      await commandRow(orcaPage, 'Paste only').click()
      await expect(
        orcaPage.getByText('This tab is back on your computer', { exact: false }).first()
      ).toBeVisible()
      expect(await readTerminalText(orcaPage, tabId)).toBe(textBefore)

      // The commands are saved by main, not held by this page.
      const saved = await orcaPage.evaluate(() => window.api.sshCommands.list())
      expect(saved.ok && saved.value.map((command) => command.name)).toEqual([
        'Write a value',
        'Paste only'
      ])
    } finally {
      cleanupDockerSshHostTarget(target)
    }
  })
})
