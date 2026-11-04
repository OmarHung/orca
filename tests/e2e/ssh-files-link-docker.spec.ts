import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  focusTerminalCell,
  readSessionTabId,
  readTerminalText,
  terminalCell
} from './helpers/ssh-docker-session'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const REMOTE_DIR = '/tmp/orca-link-e2e'
const SPACED_DIR = `${REMOTE_DIR}/with space`
const CD_LABEL = 'Type cd to this folder in the terminal'
const FOLLOW_LABEL = 'Follow the terminal’s folder'

function readRemoteFile(target: DockerSshHostTarget, file: string): string {
  return execDockerSshHostTargetCommand(target, `cat '${file}' 2>/dev/null || true`).trim()
}

/**
 * Lets the ssh Orca types log in by itself, as it would for a real host. Only the app's isolated
 * home gets this, and a config of the test's own keeps the user's known_hosts out of it.
 */
async function teachShellsToLogIn(
  page: Page,
  target: DockerSshHostTarget,
  configDir: string
): Promise<void> {
  const config = path.join(configDir, 'ssh_config')
  writeFileSync(
    config,
    [
      'Host *',
      `  IdentityFile ${target.identityFile}`,
      '  IdentitiesOnly yes',
      '  StrictHostKeyChecking no',
      '  UserKnownHostsFile /dev/null',
      '  LogLevel ERROR'
    ].join('\n')
  )
  const home = await page.evaluate(() => window.api.sftp.localHome())
  for (const startupFile of ['.zshrc', '.bashrc']) {
    writeFileSync(path.join(home, startupFile), `ssh() { command ssh -F '${config}' "$@"; }\n`)
  }
}

/** Waits for any list already asked for to finish, so a wrong move would have landed by now. */
async function settleRemoteListing(page: Page, label: string, path: string): Promise<void> {
  await page.evaluate(
    async ({ hostLabel, folder }) => {
      const targets = await window.api.ssh.listTargets()
      const target = targets.find((candidate) => candidate.label === hostLabel)
      if (target) {
        await window.api.sftp.list({ targetId: target.id, path: folder })
      }
    },
    { hostLabel: label, folder: path }
  )
}

test.describe('The terminal and the files of one tab against a Docker sshd', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')

  test('types paths without pressing Enter, and follows only this host’s shell', async ({
    orcaPage
  }, testInfo) => {
    // Logs in by hand against a Docker sshd, then checks each result on the server.
    test.setTimeout(240_000)
    let target: DockerSshHostTarget | null = null
    const configDir = mkdtempSync(path.join(os.tmpdir(), 'orca-link-e2e-'))
    try {
      target = startDockerSshHostTarget(testInfo)
      const docker = target
      execDockerSshHostTargetCommand(
        docker,
        `rm -rf ${REMOTE_DIR}; mkdir -p '${SPACED_DIR}'; : > ${REMOTE_DIR}/notes.txt`
      )
      await waitForSessionReady(orcaPage)
      const label = await addDockerTarget(orcaPage, docker, 'Link')
      await teachShellsToLogIn(orcaPage, docker, configDir)
      await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
      const sshPage = orcaPage.locator('[data-ssh-page]')
      await sshPage.locator('[data-remote-side-tab="hosts"]').click()
      await sshPage.locator('[data-ssh-host-row]').filter({ hasText: label }).click()
      const connect = orcaPage.locator('[data-command-confirm]')
      await connect.getByRole('button', { name: 'Connect' }).click()
      await expect(connect).toBeHidden()
      await expect.poll(() => readSessionTabId(orcaPage, label)).not.toBe('')
      const tabId = await readSessionTabId(orcaPage, label)
      const terminalText = (): Promise<string> => readTerminalText(orcaPage, tabId)
      await expect.poll(terminalText, { timeout: 30_000 }).toMatch(/root@[^\n]*# /)

      await orcaPage.locator('[data-remote-layout="split"]').click()
      const remotePane = orcaPage.locator('[data-sftp-pane="remote"]')
      const pathInput = remotePane.getByLabel('Path')
      // Why wait: the first folder arrives once connected, and would replace one chosen before it.
      await expect(pathInput).toHaveValue('/root', { timeout: 30_000 })
      await pathInput.fill(REMOTE_DIR)
      await pathInput.press('Enter')
      const spacedRow = remotePane.locator(`[data-sftp-entry="${SPACED_DIR}"]`)
      await expect(spacedRow).toBeVisible({ timeout: 30_000 })

      // A selected folder goes in quoted, and only the user's own Enter runs it. Had Orca pressed
      // Enter, what is typed next would start a line with && and fail.
      await spacedRow.click()
      await remotePane.getByRole('button', { name: CD_LABEL }).click()
      await expect.poll(terminalText).toContain(`cd -- '${SPACED_DIR}'`)
      await focusTerminalCell(orcaPage, tabId)
      await orcaPage.keyboard.type(` && pwd > ${REMOTE_DIR}/from-cd\n`)
      await expect.poll(() => readRemoteFile(docker, `${REMOTE_DIR}/from-cd`)).toBe(SPACED_DIR)

      // A full-screen program would take the text as its own commands, so nothing is typed.
      await orcaPage.keyboard.type(`printf '\\033[?1049h'; read line; printf '\\033[?1049l'\n`)
      const bufferType = (): Promise<string | undefined> =>
        orcaPage.evaluate(
          (id) => window.__paneManagers?.get(id)?.getPanes?.()[0]?.terminal.buffer.active.type,
          tabId
        )
      await expect.poll(bufferType).toBe('alternate')
      await remotePane.getByRole('button', { name: CD_LABEL }).click()
      await expect(orcaPage.getByText(/A full-screen program is open/).first()).toBeVisible()
      await focusTerminalCell(orcaPage, tabId)
      await orcaPage.keyboard.press('Enter')
      await expect.poll(bufferType).toBe('normal')

      // A dragged row goes in quoted and waits too. Had Orca pressed Enter, what is typed at the
      // start of the line afterwards would sit on an empty line and wait for input forever.
      await orcaPage.keyboard.type(`cd ${REMOTE_DIR}\n`)
      await pathInput.fill(REMOTE_DIR)
      await pathInput.press('Enter')
      const notesRow = remotePane.locator(`[data-sftp-entry="${REMOTE_DIR}/notes.txt"]`)
      await expect(notesRow).toBeVisible()
      await notesRow.dragTo(terminalCell(orcaPage, tabId).locator('.xterm'))
      await expect.poll(terminalText).toContain(`'${REMOTE_DIR}/notes.txt'`)
      await focusTerminalCell(orcaPage, tabId)
      await orcaPage.keyboard.press('Control+a')
      await orcaPage.keyboard.type('wc -c > from-drag ')
      await orcaPage.keyboard.press('Enter')
      await expect.poll(() => readRemoteFile(docker, `${REMOTE_DIR}/from-drag`)).toContain('0')

      // Until this shell reports a folder there is nothing to follow, so it explains how instead.
      const followButton = remotePane.getByRole('button', { name: FOLLOW_LABEL })
      await followButton.click()
      const setup = orcaPage.locator('[data-remote-follow-setup]')
      await expect(setup).toBeVisible()
      await expect(setup).toContainText('~/.bashrc')
      await orcaPage.screenshot({ path: testInfo.outputPath('follow-setup.png') })
      await orcaPage.keyboard.press('Escape')
      await expect(setup).toBeHidden()

      // Reported folders move the files pane once following is on.
      await focusTerminalCell(orcaPage, tabId)
      await orcaPage.keyboard.type(
        `report() { printf '\\033]7;file://%s%s\\033\\\\' "$1" "$2"; }; report web-1 '${REMOTE_DIR}'\n`
      )
      await expect
        .poll(async () => {
          await followButton.click()
          const isOn = await remotePane
            .getByRole('button', { name: 'Stop following the terminal’s folder' })
            .isVisible()
          if (!isOn) {
            await orcaPage.keyboard.press('Escape')
          }
          return isOn
        })
        .toBe(true)
      await focusTerminalCell(orcaPage, tabId)
      await orcaPage.keyboard.type(`report web-1 '${SPACED_DIR}'\n`)
      await expect(pathInput).toHaveValue(SPACED_DIR)

      // A report naming this computer is the local shell left when ssh ends, and one naming another
      // host means ssh went onward. Neither says anything about the host these files are on.
      await orcaPage.keyboard.type(`report '${os.hostname()}' /tmp; report db-1 /var; echo seen\n`)
      await expect.poll(terminalText).toMatch(/\nseen|seen\r?\n/)
      await settleRemoteListing(orcaPage, label, '/tmp')
      await expect(pathInput).toHaveValue(SPACED_DIR)

      // Back on this host's own reports, it moves again.
      await orcaPage.keyboard.type(`report web-1.example.test '${REMOTE_DIR}'\n`)
      await expect(pathInput).toHaveValue(REMOTE_DIR)
      await orcaPage.screenshot({ path: testInfo.outputPath('follow-on.png') })

      // An ssh nobody asked Orca for may be on another host, so the path is copied, not typed.
      await orcaPage.keyboard.type('exit\n')
      await expect(sshPage.locator('[data-ssh-session-ended]')).toBeVisible({ timeout: 30_000 })
      await orcaPage.keyboard.type(`ssh -p ${docker.port} root@127.0.0.1\n`)
      await expect(sshPage.locator('[data-ssh-session-ended]')).toBeHidden({ timeout: 30_000 })
      await remotePane.getByRole('button', { name: CD_LABEL }).click()
      await expect(
        orcaPage.getByText(/can’t confirm this terminal is on this host/).first()
      ).toBeVisible()
      expect(await terminalText()).not.toContain(`cd -- '${REMOTE_DIR}'`)
    } finally {
      cleanupDockerSshHostTarget(target)
      rmSync(configDir, { recursive: true, force: true })
    }
  })
})
