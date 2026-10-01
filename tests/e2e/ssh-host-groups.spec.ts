import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

// Why: nothing listens on the discard port; these hosts are only listed, never connected.
const HOSTS = ['e2e-group-web', 'e2e-group-api', 'e2e-group-ci']

type StoredGroups = {
  groups: { id: string; name: string; parentId: string | null }[]
  hostGroups: Record<string, string>
}

async function addHosts(page: Page): Promise<void> {
  await page.evaluate(async (labels) => {
    for (const label of labels) {
      await window.api.ssh.addTarget({
        target: { label, host: '127.0.0.1', port: 9, username: 'nobody' }
      })
    }
  }, HOSTS)
}

async function readGroups(page: Page): Promise<StoredGroups> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('orca.sshHostGroups') ?? '{}'))
}

/** Group names as stored, each with its parent's name. */
async function readGroupTree(page: Page): Promise<string[]> {
  const { groups } = await readGroups(page)
  return groups.map((group) => {
    const parent = groups.find((entry) => entry.id === group.parentId)
    return parent ? `${parent.name} > ${group.name}` : group.name
  })
}

async function readHostGroupName(page: Page, label: string): Promise<string | null> {
  const { groups, hostGroups } = await readGroups(page)
  const targetId = await page.evaluate(
    async (wanted) => (await window.api.ssh.listTargets()).find((t) => t.label === wanted)?.id,
    label
  )
  const groupId = targetId ? hostGroups[targetId] : undefined
  return groups.find((group) => group.id === groupId)?.name ?? null
}

async function createGroup(page: Page, list: Locator, name: string): Promise<void> {
  await list.locator('[data-ssh-new-group]').click()
  const input = page.getByRole('dialog').getByRole('textbox')
  await input.fill(name)
  await input.press('Enter')
  // Why: a hidden e2e window stretches the exit animation, and a dialog reopened mid-exit stays shut.
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(list.locator('[data-ssh-host-group]').filter({ hasText: name })).toBeVisible()
}

/** Drops at a height ratio inside the target, so a group lands before (low), in, or after it. */
async function dragOnto(source: Locator, target: Locator, ratio = 0.5): Promise<void> {
  const box = await target.boundingBox()
  if (!box) {
    throw new Error('drop target is not rendered')
  }
  await source.dragTo(target, { targetPosition: { x: box.width / 2, y: box.height * ratio } })
}

test('groups SSH hosts into nested, reorderable groups shared with the SFTP page', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await addHosts(orcaPage)
  await orcaPage.getByRole('button', { name: 'SSH', exact: true }).click()
  const list = orcaPage.locator('[data-ssh-page]')
  const host = (label: string): Locator =>
    list.locator('[data-ssh-host-row]').filter({ hasText: label })
  const group = (name: string): Locator =>
    list.locator('[data-ssh-host-group]').filter({ hasText: name })
  await expect(host(HOSTS[0])).toBeVisible()

  await createGroup(orcaPage, list, 'Production')
  await createGroup(orcaPage, list, 'Staging')
  await expect.poll(() => readGroupTree(orcaPage)).toEqual(['Production', 'Staging'])

  // A host dragged onto a group files under it.
  await dragOnto(host(HOSTS[0]), group('Production'))
  await expect.poll(() => readHostGroupName(orcaPage, HOSTS[0])).toBe('Production')
  await expect(group('Production')).toContainText('1')

  // A group dragged onto another's middle nests; onto its top edge, it moves before it.
  await dragOnto(group('Staging'), group('Production'))
  await expect.poll(() => readGroupTree(orcaPage)).toEqual(['Production', 'Production > Staging'])
  await dragOnto(group('Staging'), group('Production'), 0.1)
  await expect.poll(() => readGroupTree(orcaPage)).toEqual(['Staging', 'Production'])
  await expect(list.locator('[data-ssh-host-group]').first()).toContainText('Staging')

  // Right-click a group for a subgroup.
  await group('Production').click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'New Subgroup…' }).click()
  await orcaPage.getByRole('dialog').getByRole('textbox').fill('db')
  await orcaPage.getByRole('dialog').getByRole('button', { name: 'Create' }).click()
  await expect(orcaPage.getByRole('dialog')).toBeHidden()
  await expect
    .poll(() => readGroupTree(orcaPage))
    .toEqual(['Staging', 'Production', 'Production > db'])
  await dragOnto(host(HOSTS[1]), group('db'))
  await expect.poll(() => readHostGroupName(orcaPage, HOSTS[1])).toBe('db')

  await list.locator('[data-ssh-host-tree]').screenshot({ path: testInfo.outputPath('tree.png') })

  // The host's own right-click menu moves it back out.
  await host(HOSTS[0]).click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Move to Group' }).hover()
  await orcaPage.getByRole('menuitem', { name: 'Remove from Group' }).click()
  await expect.poll(() => readHostGroupName(orcaPage, HOSTS[0])).toBeNull()

  // Dragging a host onto the Ungrouped heading takes it out too.
  await dragOnto(host(HOSTS[1]), list.locator('[data-ssh-host-ungrouped]'))
  await expect.poll(() => readHostGroupName(orcaPage, HOSTS[1])).toBeNull()

  await orcaPage.getByRole('button', { name: 'SFTP', exact: true }).click()
  const sftpGroups = orcaPage.locator('[data-sftp-page] [data-ssh-host-group]')
  await expect(sftpGroups).toHaveCount(3)
  await expect(sftpGroups.first()).toContainText('Staging')
})
