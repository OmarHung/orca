import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshHostTarget,
  execDockerSshHostTargetCommand,
  startDockerSshHostTarget,
  type DockerSshHostTarget
} from './helpers/docker-ssh-host-target'
import {
  addDockerTarget,
  connectDockerTab,
  focusTerminalCell,
  readSessionTabId,
  readTerminalText,
  terminalCell
} from './helpers/ssh-docker-session'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const REMOTE_DIR = '/tmp/orca-sync-e2e'
// Why port 9: nothing listens on it, so this tab's ssh fails and leaves a local shell behind.
const LOCAL_LABEL = 'e2e-sync-local-shell'

function remoteLines(target: DockerSshHostTarget, file: string): number {
  const count = execDockerSshHostTargetCommand(
    target,
    `cat ${REMOTE_DIR}/${file} 2>/dev/null | wc -l`
  )
  return Number(count)
}

async function setPaneIncluded(page: Page, tabId: string, isIncluded: boolean): Promise<void> {
  const action = isIncluded ? 'sync-include' : 'sync-exclude'
  await terminalCell(page, tabId).locator(`[data-remote-grid-action="${action}"]`).click()
  const status = terminalCell(page, tabId).locator('[data-remote-sync-status]')
  // Why only this: an included pane may still be paused, say at a password prompt.
  await (isIncluded
    ? expect(status).not.toHaveAttribute('data-remote-sync-status', 'excluded')
    : expect(status).toHaveAttribute('data-remote-sync-status', 'excluded'))
}

/** Adds an open tab to the grid through the strip's picker. */
async function addToGrid(page: Page, control: string, tabId: string): Promise<void> {
  await page.locator(`[data-remote-grid-control="${control}"]`).click()
  await page.locator(`[data-ssh-picker-tab="${tabId}"]`).click()
  // Why wait: focus moving to the new pane would close a dialog opened before it lands.
  await expect(terminalCell(page, tabId).locator('textarea')).toBeFocused()
}

test.describe('Synced input against a Docker sshd', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Synced input is not offered on Windows.')

  test('reaches only hosts agreed to with ssh running, and stops wherever it cannot be sure', async ({
    orcaPage
  }, testInfo) => {
    // Logs in by hand on two tabs against a Docker sshd, then checks each result on the server.
    test.setTimeout(300_000)
    let target: DockerSshHostTarget | null = null
    try {
      target = startDockerSshHostTarget(testInfo)
      const docker = target
      execDockerSshHostTargetCommand(docker, `rm -rf ${REMOTE_DIR}; mkdir -p ${REMOTE_DIR}`)
      await waitForSessionReady(orcaPage)
      const oneLabel = await addDockerTarget(orcaPage, docker, 'Sync one')
      const twoLabel = await addDockerTarget(orcaPage, docker, 'Sync two')
      await orcaPage.evaluate(async (label) => {
        await window.api.ssh.addTarget({
          target: { label, host: '127.0.0.1', port: 9, username: 'nobody' }
        })
      }, LOCAL_LABEL)

      const one = await connectDockerTab(orcaPage, docker, oneLabel)
      const two = await connectDockerTab(orcaPage, docker, twoLabel)
      const sshPage = orcaPage.locator('[data-ssh-page]')
      await sshPage.locator('[data-ssh-host-row]').filter({ hasText: LOCAL_LABEL }).click()
      const connect = orcaPage.locator('[data-command-confirm]')
      await connect.getByRole('button', { name: 'Connect' }).click()
      await expect(connect).toBeHidden()
      await expect.poll(() => readSessionTabId(orcaPage, LOCAL_LABEL)).not.toBe('')
      const local = await readSessionTabId(orcaPage, LOCAL_LABEL)
      await expect
        .poll(() => readTerminalText(orcaPage, local), { timeout: 30_000 })
        .toContain('Connection refused')

      await addToGrid(orcaPage, 'start', one)
      await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(2)
      await addToGrid(orcaPage, 'add', two)
      await expect(sshPage.locator('[data-remote-grid-header]')).toHaveCount(3)

      // Nothing is on until agreed, and only hosts running ssh can be chosen.
      await orcaPage.locator('[data-remote-grid-control="sync-start"]').click()
      const dialog = orcaPage.locator('[data-remote-sync-dialog]')
      await expect(dialog.locator(`[data-remote-sync-host="${local}"]`)).toBeDisabled()
      // These two were logged in by hand, so each must be ticked on purpose.
      await expect(dialog.locator(`[data-remote-sync-host="${one}"]`)).not.toBeChecked()
      await expect(dialog.locator('[data-remote-sync-confirm]')).toBeDisabled()
      await dialog.locator(`[data-remote-sync-host="${one}"]`).click()
      await dialog.locator(`[data-remote-sync-host="${two}"]`).click()
      await orcaPage.screenshot({ path: testInfo.outputPath('ssh-sync-confirm.png') })
      await dialog.locator('[data-remote-sync-confirm]').click()
      await expect(dialog).toBeHidden()
      const bar = sshPage.locator('[data-remote-sync-bar]')
      await expect(bar).toContainText(oneLabel)
      await expect(bar).toContainText(twoLabel)
      await expect(bar).not.toContainText(LOCAL_LABEL)
      await expect(
        terminalCell(orcaPage, local).locator('[data-remote-sync-status]')
      ).toHaveAttribute('data-remote-sync-status', 'notJoined')
      await orcaPage.screenshot({ path: testInfo.outputPath('ssh-sync-on.png') })

      // Typed in one pane, it runs on both hosts, and never on this computer.
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(`echo typed-$((40+2)) >> ${REMOTE_DIR}/both\n`)
      await expect.poll(() => remoteLines(docker, 'both'), { timeout: 30_000 }).toBe(2)
      expect(await readTerminalText(orcaPage, local)).not.toContain('typed-')

      // A shortcut the terminal handles itself reaches every host too. Otherwise the source would
      // clear its line while the others kept theirs, and run something else entirely.
      if (process.platform === 'darwin') {
        await orcaPage.keyboard.type('echo stale')
        await orcaPage.keyboard.press('Meta+Backspace')
        await orcaPage.keyboard.type(`echo kept >> ${REMOTE_DIR}/shortcut\n`)
        await expect.poll(() => remoteLines(docker, 'shortcut'), { timeout: 30_000 }).toBe(2)
        expect(
          execDockerSshHostTargetCommand(docker, `sort -u ${REMOTE_DIR}/shortcut`).trim()
        ).toBe('kept')
      }

      // An excluded pane gets nothing.
      await setPaneIncluded(orcaPage, two, false)
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(`echo one-only >> ${REMOTE_DIR}/excluded\n`)
      await expect.poll(() => remoteLines(docker, 'excluded')).toBe(1)
      expect(await readTerminalText(orcaPage, two)).not.toContain('one-only')
      await setPaneIncluded(orcaPage, two, true)

      // Let back in part way through a line, it stays out, and only a Ctrl+C there brings it back.
      await setPaneIncluded(orcaPage, two, false)
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type('echo mid-')
      await setPaneIncluded(orcaPage, two, true)
      const twoStatus = terminalCell(orcaPage, two).locator('[data-remote-sync-status]')
      await expect(twoStatus).toHaveAttribute('data-remote-sync-status', 'waitingForLine')
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(`line >> ${REMOTE_DIR}/rejoin\n`)
      await expect.poll(() => remoteLines(docker, 'rejoin')).toBe(1)
      await expect(twoStatus).toHaveAttribute('data-remote-sync-status', 'outOfStep')
      await focusTerminalCell(orcaPage, two)
      await orcaPage.keyboard.press('Control+C')
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(`echo second >> ${REMOTE_DIR}/rejoin\n`)
      await expect.poll(() => remoteLines(docker, 'rejoin')).toBe(3)

      // What is typed in an excluded pane stays there, here to set up a password prompt.
      await setPaneIncluded(orcaPage, one, false)
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(
        `read -rsp 'Password: ' secret; echo "$secret" >> ${REMOTE_DIR}/secret; echo\n`
      )
      await expect.poll(() => readTerminalText(orcaPage, one)).toMatch(/Password: *$/m)
      expect(await readTerminalText(orcaPage, two)).not.toContain('read -rsp')
      await setPaneIncluded(orcaPage, one, true)

      // A pane asking for a password gets none of what is typed elsewhere.
      await expect(
        terminalCell(orcaPage, one).locator('[data-remote-sync-status]')
      ).toHaveAttribute('data-remote-sync-status', 'passwordPrompt')
      await focusTerminalCell(orcaPage, two)
      await orcaPage.keyboard.type(`echo two-typed >> ${REMOTE_DIR}/prompt\n`)
      await expect.poll(() => remoteLines(docker, 'prompt')).toBe(1)
      expect(
        execDockerSshHostTargetCommand(docker, `cat ${REMOTE_DIR}/secret 2>/dev/null || true`)
      ).not.toContain('two-typed')

      // And what is typed at a password prompt goes nowhere else.
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type('hunter2\n')
      await expect
        .poll(() => execDockerSshHostTargetCommand(docker, `cat ${REMOTE_DIR}/secret`))
        .toBe('hunter2')
      expect(await readTerminalText(orcaPage, two)).not.toContain('hunter2')

      // A full-screen program would take a shell's letters as commands.
      await setPaneIncluded(orcaPage, one, false)
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(`printf '\\033[?1049h'; read line; printf '\\033[?1049l'\n`)
      await expect
        .poll(() =>
          orcaPage.evaluate(
            (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.terminal.buffer.active.type,
            one
          )
        )
        .toBe('alternate')
      await setPaneIncluded(orcaPage, one, true)
      await focusTerminalCell(orcaPage, two)
      await orcaPage.keyboard.type(`echo shell-only >> ${REMOTE_DIR}/fullscreen\n`)
      await expect.poll(() => remoteLines(docker, 'fullscreen')).toBe(1)
      await expect(
        terminalCell(orcaPage, one).locator('[data-remote-sync-status]')
      ).toHaveAttribute('data-remote-sync-status', 'fullScreenMismatch')
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.press('Enter')
      await expect
        .poll(() =>
          orcaPage.evaluate(
            (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.terminal.buffer.active.type,
            one
          )
        )
        .toBe('normal')

      // Once ssh ends, that pane is a local shell and gets nothing more.
      await setPaneIncluded(orcaPage, one, false)
      await focusTerminalCell(orcaPage, two)
      await orcaPage.keyboard.type('exit\n')
      await expect(terminalCell(orcaPage, two).locator('[data-ssh-session-ended]')).toBeVisible({
        timeout: 30_000
      })
      await setPaneIncluded(orcaPage, one, true)
      // It stopped when it missed a key in full-screen, so it needs clearing first.
      // Why Enter: a tty drops its queue on Ctrl+C, which can eat a key typed right after it.
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.press('Enter')
      await orcaPage.keyboard.type(`echo after-exit >> ${REMOTE_DIR}/ended\n`)
      await expect.poll(() => remoteLines(docker, 'ended')).toBe(1)
      expect(await readTerminalText(orcaPage, two)).not.toContain('after-exit')

      // Nor does what is typed in that local shell reach the hosts.
      await focusTerminalCell(orcaPage, two)
      await orcaPage.keyboard.type('echo from-local-shell\n')
      await orcaPage.keyboard.type('echo from-local-again\n')
      await expect
        .poll(() => readTerminalText(orcaPage, two))
        .toMatch(/from-local-again[\s\S]*from-local-again/)
      expect(await readTerminalText(orcaPage, one)).not.toContain('from-local')

      // A whole line goes from the box under the bar, and says which host missed it.
      await bar.locator('[data-remote-sync-mode="line"]').click()
      const lineBox = bar.locator('[data-remote-sync-line]')
      await lineBox.fill(`echo whole-line >> ${REMOTE_DIR}/line`)
      await lineBox.press('Enter')
      await expect.poll(() => remoteLines(docker, 'line')).toBe(1)
      await expect(orcaPage.getByText(`${twoLabel}:`, { exact: false }).first()).toBeVisible()
      expect(await readTerminalText(orcaPage, two)).not.toContain('whole-line')

      // Typing in a pane reaches only that pane while whole lines are in use.
      await focusTerminalCell(orcaPage, one)
      await orcaPage.keyboard.type(`echo typed-here >> ${REMOTE_DIR}/typed\n`)
      await expect.poll(() => remoteLines(docker, 'typed')).toBe(1)
      expect(await readTerminalText(orcaPage, two)).not.toContain('typed-here')

      // Fewer than two hosts left ends sync by itself.
      await terminalCell(orcaPage, two).locator('[data-remote-grid-action="remove"]').click()
      await expect(bar).toBeHidden()
      await expect(orcaPage.locator('[data-remote-grid-control="sync-start"]')).toBeVisible()
    } finally {
      cleanupDockerSshHostTarget(target)
    }
  })
})
