import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  cleanupDockerSshRelayTarget,
  execDockerSshRelayTargetCommand,
  startDockerSshRelayTarget,
  type DockerSshRelayTarget
} from './helpers/docker-ssh-relay-target'
import { waitForSessionReady } from './helpers/store'

const RUN_DOCKER_SSH = process.env.ORCA_E2E_SSH_DOCKER === '1'
const REMOTE_DIR = '/tmp/orca-sftp-e2e'

async function addDockerTarget(page: Page, target: DockerSshRelayTarget): Promise<string> {
  return page.evaluate(
    async ({ host, port, identityFile }) => {
      const result = await window.api.ssh.addTarget({
        target: {
          label: `Docker SFTP E2E ${Date.now()}`,
          host,
          port,
          username: 'root',
          identityFile,
          identitiesOnly: true
        }
      })
      return result.target.id
    },
    { host: target.host, port: target.port, identityFile: target.identityFile }
  )
}

test.describe('SFTP page against a Docker sshd', () => {
  test.skip(!RUN_DOCKER_SSH, 'Set ORCA_E2E_SSH_DOCKER=1 to run Docker-backed SSH E2E.')
  test.skip(process.platform === 'win32', 'Docker SSH E2E uses POSIX ssh tooling.')

  test('lists, uploads, downloads and deletes without the relay', async ({
    orcaPage
  }, testInfo) => {
    test.setTimeout(180_000)
    let target: DockerSshRelayTarget | null = null
    const localRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-sftp-e2e-'))
    try {
      target = startDockerSshRelayTarget(testInfo)
      await waitForSessionReady(orcaPage)
      const targetId = await addDockerTarget(orcaPage, target)
      const outbox = path.join(localRoot, 'outbox')
      const inbox = path.join(localRoot, 'inbox')
      mkdirSync(path.join(outbox, 'nested'), { recursive: true })
      mkdirSync(inbox)
      writeFileSync(path.join(outbox, 'hello.txt'), 'hello sftp')
      writeFileSync(path.join(outbox, 'nested', 'deep.txt'), 'deep')

      const result = await orcaPage.evaluate(
        async ({ targetId, remoteDir, sources, inbox }) => {
          const sftp = window.api.sftp
          const run = async (request: Parameters<typeof sftp.plan>[0], transferId: string) => {
            const planned = await sftp.plan(request)
            if (!planned.ok) {
              return { planned, executed: null, replayed: null }
            }
            const executed = await sftp.execute({ planId: planned.value.planId, transferId })
            const replayed = await sftp.execute({ planId: planned.value.planId, transferId })
            return { planned, executed, replayed }
          }
          const home = await sftp.home(targetId)
          const mkdir = await run({ kind: 'mkdir', targetId, path: remoteDir }, 'mk-1')
          const upload = await run(
            { kind: 'upload', targetId, sources, destinationDir: remoteDir },
            'up-1'
          )
          const conflict = await sftp.plan({
            kind: 'upload',
            targetId,
            sources,
            destinationDir: remoteDir
          })
          if (conflict.ok) {
            await sftp.discardPlan(conflict.value.planId)
          }
          const forged = await sftp.execute({ planId: 'not-a-plan', transferId: 'x' })
          const listing = await sftp.list({ targetId, path: remoteDir })
          const download = await run(
            {
              kind: 'download',
              targetId,
              sources: [`${remoteDir}/hello.txt`, `${remoteDir}/nested`],
              destinationDir: inbox
            },
            'down-1'
          )
          return { home, mkdir, upload, conflict, forged, listing, download }
        },
        {
          targetId,
          remoteDir: REMOTE_DIR,
          sources: [path.join(outbox, 'hello.txt'), path.join(outbox, 'nested')],
          inbox
        }
      )

      const done = { ok: true, value: { status: 'done' } }
      expect(result.home).toEqual({ ok: true, value: '/root' })
      expect(result.mkdir.executed).toEqual(done)
      expect(result.upload.executed).toEqual(done)
      expect(result.upload.planned.ok && result.upload.planned.value.operations).toEqual([
        {
          op: 'put',
          local: path.join(outbox, 'hello.txt'),
          remote: `${REMOTE_DIR}/hello.txt`,
          size: 10
        },
        { op: 'mkdir', path: `${REMOTE_DIR}/nested`, keepExisting: true },
        {
          op: 'put',
          local: path.join(outbox, 'nested', 'deep.txt'),
          remote: `${REMOTE_DIR}/nested/deep.txt`,
          size: 4
        }
      ])
      // A plan runs once; a plan id main never issued runs nothing.
      expect(result.upload.replayed?.ok).toBe(false)
      expect(result.forged.ok).toBe(false)
      expect(result.conflict.ok && result.conflict.value.conflicts).toEqual(['hello.txt', 'nested'])
      expect(result.listing.ok && result.listing.value.map((entry) => entry.name)).toEqual([
        'nested',
        'hello.txt'
      ])
      expect(execDockerSshRelayTargetCommand(target, `cat ${REMOTE_DIR}/nested/deep.txt`)).toBe(
        'deep'
      )
      expect(result.download.executed).toEqual(done)
      expect(readFileSync(path.join(inbox, 'hello.txt'), 'utf8')).toBe('hello sftp')
      expect(readFileSync(path.join(inbox, 'nested', 'deep.txt'), 'utf8')).toBe('deep')
      expect(existsSync(path.join(inbox, 'hello.txt.orca-download'))).toBe(false)

      // Why: SFTP runs on its own connection; the relay's per-host status must not claim one.
      const relayStatus = await orcaPage.evaluate(
        (id) => window.__store?.getState().sshConnectionStates.get(id)?.status ?? null,
        targetId
      )
      expect(relayStatus).not.toBe('connected')

      const removal = await orcaPage.evaluate(
        async ({ targetId, remoteDir }) => {
          const planned = await window.api.sftp.plan({
            kind: 'remove',
            targetId,
            paths: [remoteDir]
          })
          return planned.ok
            ? window.api.sftp.execute({ planId: planned.value.planId, transferId: 'rm-1' })
            : planned
        },
        { targetId, remoteDir: REMOTE_DIR }
      )
      expect(removal).toEqual({ ok: true, value: { status: 'done' } })
      expect(
        execDockerSshRelayTargetCommand(target, `test -e ${REMOTE_DIR} && echo yes || echo no`)
      ).toBe('no')

      execDockerSshRelayTargetCommand(target, 'touch /root/orca-sftp-visible.txt')
      await orcaPage.getByRole('button', { name: 'SFTP', exact: true }).click()
      await orcaPage.locator('[data-ssh-host-row]').filter({ hasText: 'Docker SFTP E2E' }).click()
      await expect(orcaPage.locator('[data-sftp-entry^="/root/"]').first()).toBeVisible({
        timeout: 30_000
      })
      await orcaPage.screenshot({ path: testInfo.outputPath('sftp-page.png') })

      // Why: hidden tabs stay mounted, so every UI lookup is scoped to the tab on screen.
      const activeTab = orcaPage.locator('[data-sftp-tab-panel][data-active="true"]')
      const localPane = activeTab.locator('[data-sftp-pane="local"]')
      const remotePane = activeTab.locator('[data-sftp-pane="remote"]')

      // The UI only downloads after showing the exact command and getting a yes.
      const localPath = localPane.locator('input[aria-label="Path"]')
      await localPath.fill(inbox)
      await localPath.press('Enter')
      await expect(
        localPane.locator(`[data-sftp-entry="${path.join(inbox, 'hello.txt')}"]`)
      ).toBeVisible()
      await remotePane.locator('[data-sftp-entry="/root/orca-sftp-visible.txt"]').click()
      const downloadButton = remotePane.getByRole('button', { name: 'Download', exact: true })
      await downloadButton.click()
      const confirmDialog = orcaPage.locator('[data-command-confirm]')
      await expect(confirmDialog.locator('[data-command-list]')).toContainText(
        `get "/root/orca-sftp-visible.txt" ${JSON.stringify(path.join(inbox, 'orca-sftp-visible.txt'))}`
      )
      await orcaPage.screenshot({ path: testInfo.outputPath('sftp-confirm.png') })
      await confirmDialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmDialog).toBeHidden()
      expect(existsSync(path.join(inbox, 'orca-sftp-visible.txt'))).toBe(false)
      await downloadButton.click()
      await confirmDialog.getByRole('button', { name: 'Download', exact: true }).click()
      await expect.poll(() => existsSync(path.join(inbox, 'orca-sftp-visible.txt'))).toBe(true)
      await expect(orcaPage.locator('[data-slot="dialog-overlay"]')).toHaveCount(0)

      // Files show their extension on the icon.
      await expect(
        localPane.locator(
          `[data-sftp-entry="${path.join(inbox, 'hello.txt')}"] svg[data-extension="TXT"]`
        )
      ).toBeVisible()
      await localPane.screenshot({ path: testInfo.outputPath('sftp-local-pane.png') })

      // Dragging a header divider resizes that column in both panes.
      const nameHeader = remotePane.locator('[data-sftp-column="name"]')
      const widthBefore = (await nameHeader.boundingBox())?.width ?? 0
      const divider = await remotePane.locator('[data-sftp-resize="name"]').boundingBox()
      if (!divider) {
        throw new Error('name column divider not rendered')
      }
      const dividerY = divider.y + divider.height / 2
      await orcaPage.mouse.move(divider.x + divider.width / 2, dividerY)
      await orcaPage.mouse.down()
      await orcaPage.mouse.move(divider.x + divider.width / 2 + 60, dividerY, { steps: 5 })
      await orcaPage.mouse.up()
      await expect
        .poll(async () => Math.round((await nameHeader.boundingBox())?.width ?? 0))
        .toBe(Math.round(widthBefore + 60))
      const localNameWidth = (await localPane.locator('[data-sftp-column="name"]').boundingBox())
        ?.width
      expect(Math.round(localNameWidth ?? 0)).toBe(Math.round(widthBefore + 60))

      // A second tab on the same host browses on its own; each tab keeps its folder.
      await remotePane.locator('[data-sftp-entry="/root/.ssh"]').dblclick()
      const remotePath = remotePane.locator('input[aria-label="Path"]')
      await expect(remotePath).toHaveValue('/root/.ssh')
      const sftpPage = orcaPage.locator('[data-sftp-page]')
      await sftpPage.getByRole('button', { name: 'New tab' }).click()
      const picker = orcaPage.getByRole('dialog', { name: 'Open an SFTP tab' })
      await picker.locator('[data-ssh-host-row]').filter({ hasText: 'Docker SFTP E2E' }).click()
      await expect(picker).toBeHidden()
      const sftpTabs = sftpPage.locator('[role="tab"]')
      await expect(sftpTabs).toHaveCount(2)
      await expect(remotePath).toHaveValue('/root', { timeout: 30_000 })
      // The new tab opens the local folder this host showed last.
      await expect(localPath).toHaveValue(inbox)
      await expect(sftpTabs.first().locator('[data-tab-folder]')).toHaveText('.ssh')
      await expect(sftpTabs.nth(1).locator('[data-tab-folder]')).toHaveText('root')
      await orcaPage.screenshot({ path: testInfo.outputPath('sftp-two-tabs.png') })
      await sftpTabs.first().click()
      await expect(remotePath).toHaveValue('/root/.ssh')

      // Leaving the page and coming back keeps the tabs, folders and listings.
      await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
      await expect(sftpPage).toBeHidden()
      await orcaPage.getByRole('button', { name: 'SFTP', exact: true }).click()
      await expect(sftpTabs).toHaveCount(2)
      await expect(remotePath).toHaveValue('/root/.ssh')
      await expect(
        remotePane.locator('[data-sftp-entry="/root/.ssh/authorized_keys"]')
      ).toBeVisible()

      // Closing the active tab moves to its neighbour.
      await sftpTabs.first().hover()
      await sftpTabs
        .first()
        .getByRole('button', { name: /^Close tab/ })
        .click()
      await expect(sftpTabs).toHaveCount(1)
      await expect(remotePath).toHaveValue('/root')
    } finally {
      cleanupDockerSshRelayTarget(target)
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})
