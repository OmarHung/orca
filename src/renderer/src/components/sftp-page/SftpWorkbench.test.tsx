// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SftpEntry } from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { ConfirmationDialogProvider } from '../confirmation-dialog'
import { TooltipProvider } from '../ui/tooltip'
import { SftpWorkbench } from './SftpWorkbench'
import { useSftpTransfersStore } from './sftp-transfers-store'

const target: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

function entry(path: string, kind: SftpEntry['kind'], size = 10): SftpEntry {
  return { name: path.split('/').pop() ?? path, path, kind, size, modifiedMs: 1_700_000_000_000 }
}

const remoteListings: Record<string, SftpEntry[]> = {
  '/srv': [entry('/srv/app', 'directory'), entry('/srv/log.txt', 'file')],
  '/srv/app': [entry('/srv/app/index.js', 'file')]
}

const api = {
  localHome: vi.fn(async () => '/Users/dev'),
  localList: vi.fn(async () => ({ ok: true, value: [entry('/Users/dev/report.csv', 'file')] })),
  home: vi.fn(async () => ({ ok: true, value: '/srv' })),
  list: vi.fn(async ({ path }: { path: string }) => ({
    ok: true,
    value: remoteListings[path] ?? []
  })),
  download: vi.fn(async () => ({ ok: true, value: { status: 'done' } })),
  upload: vi.fn(),
  remove: vi.fn(async () => ({ ok: true, value: undefined })),
  getPathForFile: vi.fn(() => '')
}

let container: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.clearAllMocks()
  useSftpTransfersStore.setState({ transfers: [] })
  Reflect.set(window, 'api', { sftp: api })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <ConfirmationDialogProvider>
          <SftpWorkbench target={target} />
        </ConfirmationDialogProvider>
      </TooltipProvider>
    )
  })
  await vi.waitFor(() => expect(row('/srv/log.txt')).not.toBeNull())
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  Reflect.deleteProperty(window, 'api')
})

function row(path: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-sftp-entry="${path}"]`)
}

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === name || candidate.textContent === name
  )
  if (!found) {
    throw new Error(`button "${name}" not found`)
  }
  return found
}

async function click(element: HTMLElement | null, init: MouseEventInit = {}): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }))
  })
}

describe('SftpWorkbench', () => {
  it('downloads the selected remote file into the local folder, never overwriting by default', async () => {
    await click(row('/srv/log.txt'))
    await click(button('Download'))

    await vi.waitFor(() =>
      expect(api.download).toHaveBeenCalledWith(
        expect.objectContaining({
          targetId: 'web',
          sources: ['/srv/log.txt'],
          destinationDir: '/Users/dev',
          overwrite: false
        })
      )
    )
  })

  it('opens a remote folder on double-click', async () => {
    await act(async () => {
      row('/srv/app')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    await vi.waitFor(() => expect(row('/srv/app/index.js')).not.toBeNull())
    expect(api.list).toHaveBeenLastCalledWith({ targetId: 'web', path: '/srv/app' })
  })

  it('deletes only after the user confirms', async () => {
    await click(row('/srv/log.txt'))

    await click(button('Delete'))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).not.toBeNull()
    )
    await click(button('Cancel'))
    expect(api.remove).not.toHaveBeenCalled()

    await click(button('Delete'))
    await vi.waitFor(() =>
      expect(document.querySelector('[role="alertdialog"], [role="dialog"]')).not.toBeNull()
    )
    const dialog = document.querySelector('[role="alertdialog"], [role="dialog"]')
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent === 'Delete'
    )
    await click(confirm ?? null)

    await vi.waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith({ targetId: 'web', paths: ['/srv/log.txt'] })
    )
  })
})
