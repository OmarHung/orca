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

      // The UI only downloads after showing the exact command and getting a yes.
      const localPath = orcaPage.locator('[data-sftp-pane="local"] input[aria-label="Path"]')
      await localPath.fill(inbox)
      await localPath.press('Enter')
      await expect(
        orcaPage.locator(`[data-sftp-entry="${path.join(inbox, 'hello.txt')}"]`)
      ).toBeVisible()
      await orcaPage.locator('[data-sftp-entry="/root/orca-sftp-visible.txt"]').click()
      await orcaPage.getByRole('button', { name: 'Download', exact: true }).click()
      const confirmDialog = orcaPage.locator('[data-command-confirm]')
      await expect(confirmDialog.locator('[data-command-list]')).toContainText(
        `get "/root/orca-sftp-visible.txt" ${JSON.stringify(path.join(inbox, 'orca-sftp-visible.txt'))}`
      )
      await orcaPage.screenshot({ path: testInfo.outputPath('sftp-confirm.png') })
      await confirmDialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(confirmDialog).toBeHidden()
      expect(existsSync(path.join(inbox, 'orca-sftp-visible.txt'))).toBe(false)
      await orcaPage.getByRole('button', { name: 'Download', exact: true }).click()
      await confirmDialog.getByRole('button', { name: 'Download', exact: true }).click()
      await expect.poll(() => existsSync(path.join(inbox, 'orca-sftp-visible.txt'))).toBe(true)

      // Leaving the page and coming back keeps the host, folder and listing.
      const sftpPage = orcaPage.locator('[data-sftp-page]')
      await sftpPage.locator('[data-sftp-entry="/root/.ssh"]').dblclick()
      const remotePath = sftpPage.locator('input[aria-label="Path"]').nth(1)
      await expect(remotePath).toHaveValue('/root/.ssh')
      await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
      await expect(sftpPage).toBeHidden()
      await orcaPage.getByRole('button', { name: 'SFTP', exact: true }).click()
      await expect(remotePath).toHaveValue('/root/.ssh')
      await expect(sftpPage.locator('[data-sftp-entry="/root/.ssh/authorized_keys"]')).toBeVisible()
    } finally {
      cleanupDockerSshRelayTarget(target)
      rmSync(localRoot, { recursive: true, force: true })
    }
  })
})
