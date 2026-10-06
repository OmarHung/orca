import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { test, expect } from './helpers/orca-app'
import {
  activateGoldenWorktree,
  cleanupGoldenWorktree,
  createGoldenWorktree
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

// Why a fake agent: the real one would put the test's ports on the internet. It speaks the same
// local API (endpoint-shaped lists, tunnel-shaped creates) and logs the same JSON lines.
const FAKE_NGROK_SCRIPT = `#!/usr/bin/env node
if (process.argv[2] === 'config' && process.argv[3] === 'check') {
  console.log('Valid configuration file at ' + require('path').join(__dirname, 'ngrok.yml'))
  process.exit(0)
}
const http = require('http')
const endpoints = new Map()
// Like the real agent, which loads ngrok.yml and so refuses another endpoint under a name it defines.
const configuredNames = () => {
  try {
    const text = require('fs').readFileSync(require('path').join(__dirname, 'ngrok.yml'), 'utf8')
    return [...text.matchAll(/^\\s*-?\\s*name:\\s*(\\S+)/gm)].map((match) => match[1])
  } catch {
    return []
  }
}
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    const [, , collection, name] = req.url.split('/')
    if (req.method === 'GET' && collection === 'endpoints') {
      return json(res, 200, {
        endpoints: [...endpoints.values()].map((e) => ({ name: e.name, url: e.url, upstream: { url: e.upstream } }))
      })
    }
    if (req.method === 'POST' && collection === 'endpoints') {
      const request = JSON.parse(body)
      if (configuredNames().includes(request.name) || endpoints.has(request.name)) {
        return json(res, 400, { msg: 'invalid endpoint configuration', details: { err: 'tunnel "' + request.name + '" already exists' } })
      }
      const endpoint = { name: request.name, url: request.url || 'https://' + request.name + '.e2e.ngrok.test', upstream: request.upstream.url }
      endpoints.set(endpoint.name, endpoint)
      return json(res, 201, { name: endpoint.name, public_url: endpoint.url, config: { addr: endpoint.upstream } })
    }
    if (req.method === 'DELETE' && name) {
      endpoints.delete(decodeURIComponent(name))
      res.writeHead(204)
      return res.end()
    }
    json(res, 404, { msg: 'not found' })
  })
})
server.listen(0, '127.0.0.1', () => {
  const log = (record) => process.stdout.write(JSON.stringify(record) + '\\n')
  log({ lvl: 'info', msg: 'starting web service', obj: 'web', addr: '127.0.0.1:' + server.address().port })
  log({ lvl: 'info', msg: 'client session established', obj: 'tunnels.session' })
})
process.on('SIGTERM', () => process.exit(0))
`

const FAKE_NGROK_DIR = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-ngrok-'))
const FAKE_NGROK = path.join(FAKE_NGROK_DIR, 'ngrok')
/** The fake's `ngrok config check` answers with this file. */
const FAKE_NGROK_CONFIG = path.join(FAKE_NGROK_DIR, 'ngrok.yml')
writeFileSync(FAKE_NGROK, FAKE_NGROK_SCRIPT, { mode: 0o755 })

test.use({ launchEnv: { ORCA_NGROK_PATH: FAKE_NGROK, ORCA_BACKGROUND_LAUNCH: '1' } })
test.skip(process.platform === 'win32', 'the fake agent is a #! script')

type MainProbe = { opened: string[]; copied: string[] }

/** Records system-browser opens and clipboard writes in main instead of touching the user's. */
async function recordMainSideEffects(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ shell, clipboard }) => {
    const probe: MainProbe = { opened: [], copied: [] }
    Object.assign(globalThis, { __ngrokE2eProbe: probe })
    shell.openExternal = async (url: string) => {
      probe.opened.push(url)
    }
    clipboard.writeText = (text: string) => {
      probe.copied.push(text)
    }
    clipboard.readText = () => probe.copied.at(-1) ?? ''
  })
}

async function mainProbe(electronApp: ElectronApplication): Promise<MainProbe> {
  return electronApp.evaluate(() => {
    const probe: unknown = Reflect.get(globalThis, '__ngrokE2eProbe')
    const list = (key: string): string[] => {
      const value: unknown = probe && typeof probe === 'object' ? Reflect.get(probe, key) : null
      return Array.isArray(value) ? value.map(String) : []
    }
    return { opened: list('opened'), copied: list('copied') }
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function serverCommand(port: number): string {
  return `node -e "require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1')"`
}

/** The status bar's Ports popover, where a local workspace manages its ports. */
async function openPortsPopover(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Ports, / }).click()
  await expect(page.getByTestId('ngrok-section')).toBeVisible()
}

/** This test's endpoint row; the popover also lists endpoints of any other agent on the machine. */
function ngrokEndpointRow(page: Page, port: number): Locator {
  return page
    .getByTestId('ngrok-section')
    .getByTestId('ngrok-endpoint-row')
    .filter({ hasText: `orca-${port}.e2e.ngrok.test` })
}

test('shares a run port with ngrok from the Run panel and stops it from the Ports popover', async ({
  electronApp,
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'ngrok-share')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const port = await freePort()
  const label = 'E2E ngrok server'
  const publicUrl = `https://orca-${port}.e2e.ngrok.test`

  await waitForSessionReady(orcaPage)
  await recordMainSideEffects(electronApp)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async ({ label, command }) => {
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: [
          {
            id: 'e2e-ngrok-share',
            label,
            scope: { type: 'global' as const },
            action: 'terminal-command' as const,
            command,
            appendEnter: true
          }
        ]
      })
    },
    { label, command: serverCommand(port) }
  )
  await orcaPage.getByTestId('run-configurations-trigger').click()
  await orcaPage.getByRole('menuitem', { name: label }).click()
  await orcaPage.getByRole('button', { name: `Run quick command: ${label}` }).click()

  // The Run panel offers sharing beside the port; sharing shows the public URL and copies it.
  const panel = orcaPage.getByTestId('bottom-panel')
  await expect(panel.locator(`[data-testid="run-port-link"][data-port="${port}"]`)).toBeVisible({
    timeout: 30_000
  })
  await panel.getByTestId('ngrok-share-toggle').click()
  const panelPublicLink = panel.getByTestId('run-port-ngrok-link')
  await expect(panelPublicLink).toContainText(`orca-${port}.e2e.ngrok.test`, { timeout: 20_000 })
  await expect.poll(async () => (await mainProbe(electronApp)).copied).toContain(publicUrl)
  // The compact Run widget shows that the port is public too.
  await expect(
    orcaPage.getByTestId('run-configurations-widget').getByTestId('run-port-ngrok-link')
  ).toBeVisible()

  await panelPublicLink.click()
  // shell.openUrl normalizes the URL, adding the root path.
  await expect.poll(async () => (await mainProbe(electronApp)).opened).toContain(`${publicUrl}/`)

  // The Ports popover lists the endpoint, and the port's row shows its public URL.
  await openPortsPopover(orcaPage)
  // Why filtered: an ngrok the developer runs is listed too, and must stay untouched.
  const endpointRow = ngrokEndpointRow(orcaPage, port)
  await expect(endpointRow).toHaveCount(1, { timeout: 30_000 })
  await expect(endpointRow).toContainText(`127.0.0.1:${port}`)
  await expect(orcaPage.getByTestId('ngrok-public-url').first()).toBeVisible({ timeout: 30_000 })
  await orcaPage.screenshot({ path: testInfo.outputPath('ngrok-shared.png') })

  await endpointRow.hover()
  await endpointRow.getByRole('button', { name: 'Stop Sharing' }).click()
  await expect(endpointRow).toHaveCount(0)
  await expect(panelPublicLink).toHaveCount(0)
  await expect(panel.getByTestId('ngrok-share-toggle')).toBeVisible()

  // The port's own row in the popover shares it again.
  await orcaPage
    .locator('[data-slot="popover-content"]')
    .getByRole('button', { name: 'Share publicly with ngrok' })
    .click()
  await expect(endpointRow).toHaveCount(1, { timeout: 20_000 })
  await expect(panelPublicLink).toContainText(`orca-${port}.e2e.ngrok.test`)
})

test('a run configuration set to share with ngrok shares its port and stops with the run', async ({
  electronApp,
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'ngrok-auto')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const port = await freePort()

  await waitForSessionReady(orcaPage)
  await recordMainSideEffects(electronApp)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)

  await expect(orcaPage.getByRole('menu')).toHaveCount(0)
  await orcaPage.getByTestId('run-configurations-trigger').first().click()
  await orcaPage.getByTestId('run-configurations-edit').click()
  const dialog = orcaPage.getByTestId('edit-run-configurations-dialog')
  await dialog.getByTestId('run-configuration-add-command').click()
  await dialog.getByTestId('run-configuration-name').fill('Public web')
  await dialog.getByTestId('run-configuration-command').fill(serverCommand(port))
  await dialog.getByTestId('run-configuration-ngrok').click()
  await dialog.getByTestId('run-configuration-ngrok-port').fill(String(port))
  await orcaPage.screenshot({ path: testInfo.outputPath('ngrok-run-configuration.png') })
  await dialog.getByTestId('run-configurations-save').click()
  await expect(dialog).toHaveCount(0)

  await orcaPage.getByTestId('run-configurations-launch').first().click()
  const panelPublicLink = orcaPage.getByTestId('bottom-panel').getByTestId('run-port-ngrok-link')
  await expect(panelPublicLink).toContainText(`orca-${port}.e2e.ngrok.test`, { timeout: 30_000 })
  await expect
    .poll(async () => (await mainProbe(electronApp)).copied)
    .toContain(`https://orca-${port}.e2e.ngrok.test`)

  await openPortsPopover(orcaPage)
  const endpointRow = ngrokEndpointRow(orcaPage, port)
  await expect(endpointRow).toHaveCount(1, { timeout: 30_000 })

  // Stopping the run stops sharing its port.
  await orcaPage.getByTestId('run-stop').first().click()
  await expect(endpointRow).toHaveCount(0, { timeout: 30_000 })
})

test('starts an ngrok.yml endpoint at its reserved URL, and shares its port there', async ({
  electronApp,
  orcaPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  test.setTimeout(120_000)
  const fixture = createGoldenWorktree(testRepoPath, 'ngrok-config')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  const port = await freePort()
  const label = 'E2E ngrok config server'
  const reservedHost = `fixed-${port}.e2e.ngrok.test`
  writeFileSync(
    FAKE_NGROK_CONFIG,
    `version: "3"\nendpoints:\n  - name: e2e-api\n    url: https://${reservedHost}\n    upstream:\n      url: ${port}\n`
  )
  registerPostElectronShutdownCleanup(async () => rmSync(FAKE_NGROK_CONFIG, { force: true }))

  await waitForSessionReady(orcaPage)
  await recordMainSideEffects(electronApp)
  await activateGoldenWorktree(orcaPage, testRepoPath, fixture.worktreePath)
  await orcaPage.evaluate(
    async ({ label, command }) => {
      await window.__store?.getState().updateSettings({
        terminalQuickCommands: [
          {
            id: 'e2e-ngrok-config',
            label,
            scope: { type: 'global' as const },
            action: 'terminal-command' as const,
            command,
            appendEnter: true
          }
        ]
      })
    },
    { label, command: serverCommand(port) }
  )
  await orcaPage.getByTestId('run-configurations-trigger').click()
  await orcaPage.getByRole('menuitem', { name: label }).click()
  await orcaPage.getByRole('button', { name: `Run quick command: ${label}` }).click()
  const panel = orcaPage.getByTestId('bottom-panel')
  await expect(panel.locator(`[data-testid="run-port-link"][data-port="${port}"]`)).toBeVisible({
    timeout: 30_000
  })

  // The popover lists ngrok.yml's endpoint as not running; Start is `ngrok start e2e-api`.
  await openPortsPopover(orcaPage)
  const configuredRow = orcaPage
    .getByTestId('ngrok-section')
    .getByTestId('ngrok-configured-row')
    .filter({ hasText: reservedHost })
  await expect(configuredRow).toHaveCount(1, { timeout: 30_000 })
  await configuredRow.hover()
  await configuredRow.getByRole('button', { name: 'Start e2e-api' }).click()
  const endpointRow = orcaPage
    .getByTestId('ngrok-section')
    .getByTestId('ngrok-endpoint-row')
    .filter({ hasText: reservedHost })
  await expect(endpointRow).toHaveCount(1, { timeout: 20_000 })
  await expect(configuredRow).toHaveCount(0)
  await expect
    .poll(async () => (await mainProbe(electronApp)).copied)
    .toContain(`https://${reservedHost}`)

  // Stopped, it is offered again; sharing its port from the Run panel brings it up at its URL.
  await endpointRow.hover()
  await endpointRow.getByRole('button', { name: 'Stop Sharing' }).click()
  await expect(configuredRow).toHaveCount(1, { timeout: 20_000 })
  await panel.getByTestId('ngrok-share-toggle').click()
  await expect(panel.getByTestId('run-port-ngrok-link')).toContainText(reservedHost, {
    timeout: 20_000
  })
})
