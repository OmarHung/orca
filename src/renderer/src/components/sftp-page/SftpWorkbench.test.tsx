// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SftpEntry, SftpPlanRequest } from '../../../../shared/sftp-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { CommandConfirmProvider } from '../command-confirm/CommandConfirmProvider'
import { TooltipProvider } from '../ui/tooltip'
import { SftpWorkbench } from './SftpWorkbench'
import { useSftpColumnsStore } from './sftp-columns-store'
import {
  readHostLocalFolder,
  saveHostLocalFolder,
  useSftpDefaultLocalFolder
} from './sftp-local-folder-memory'
import { DEFAULT_SFTP_COLUMN_WIDTHS } from './sftp-columns'
import { DEFAULT_SFTP_SORT } from './sftp-entry-sort'
import { useSftpTransfersStore } from './sftp-transfers-store'

const target: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

const otherTarget: SshTarget = { ...target, id: 'db', label: 'db-prod', host: '203.0.113.11' }

function entry(path: string, kind: SftpEntry['kind'], size = 10): SftpEntry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    kind,
    size,
    modifiedMs: 1_700_000_000_000,
    createdMs: null,
    owner: null
  }
}

const remoteListings: Record<string, SftpEntry[]> = {
  '/srv': [
    entry('/srv/app', 'directory'),
    entry('/srv/log.txt', 'file'),
    entry('/srv/big.bin', 'file', 500)
  ],
  '/srv/app': [entry('/srv/app/index.js', 'file')]
}

const localListings: Record<string, SftpEntry[]> = {
  '/Users/dev': [entry('/Users/dev/report.csv', 'file'), entry('/Users/dev/notes', 'directory')],
  '/Users/dev/notes': [entry('/Users/dev/notes/todo.md', 'file')]
}

const api = {
  localHome: vi.fn(async () => '/Users/dev'),
  localList: vi.fn(async (path: string) =>
    localListings[path]
      ? { ok: true, value: localListings[path] }
      : { ok: false, error: { message: `ENOENT: ${path}` } }
  ),
  home: vi.fn(async () => ({ ok: true, value: '/srv' })),
  list: vi.fn(async ({ path }: { path: string }) => ({
    ok: true,
    value: remoteListings[path] ?? []
  })),
  plan: vi.fn(async (request: SftpPlanRequest) => ({
    ok: true,
    value: {
      planId: `plan-${request.kind}`,
      kind: request.kind,
      targetId: request.targetId,
      operations:
        request.kind === 'download'
          ? [{ op: 'get', remote: '/srv/log.txt', local: '/Users/dev/log.txt', size: 10 }]
          : request.kind === 'move'
            ? request.sources.map((from) => ({
                op: 'rename',
                from,
                to: `${request.destinationDir}/${from.split('/').pop()}`
              }))
            : [{ op: 'rm', path: '/srv/log.txt' }],
      totalBytes: 10,
      conflicts: []
    }
  })),
  execute: vi.fn(async () => ({ ok: true, value: { status: 'done' } })),
  discardPlan: vi.fn(async () => undefined),
  getPathForFile: vi.fn(() => '')
}

let container: HTMLDivElement
let root: Root

async function renderWorkbench(shownTarget: SshTarget = target): Promise<void> {
  root = createRoot(container)
  await act(async () => {
    root.render(
      <TooltipProvider>
        <CommandConfirmProvider>
          <SftpWorkbench target={shownTarget} />
        </CommandConfirmProvider>
      </TooltipProvider>
    )
  })
  await vi.waitFor(() => expect(row('/srv/log.txt')).not.toBeNull())
}

beforeEach(async () => {
  vi.clearAllMocks()
  window.localStorage.clear()
  useSftpDefaultLocalFolder.setState({ defaultFolder: null })
  useSftpTransfersStore.setState({ transfers: [] })
  useSftpColumnsStore.setState({
    hiddenColumns: [],
    sortByPane: { local: DEFAULT_SFTP_SORT, remote: DEFAULT_SFTP_SORT },
    columnWidths: { ...DEFAULT_SFTP_COLUMN_WIDTHS }
  })
  Reflect.set(window, 'api', { sftp: api })
  container = document.createElement('div')
  document.body.appendChild(container)
  await renderWorkbench()
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

function remotePane(): HTMLElement {
  const pane = document.querySelector<HTMLElement>('[data-sftp-pane="remote"]')
  if (!pane) {
    throw new Error('remote pane not rendered')
  }
  return pane
}

function remoteRowPaths(): string[] {
  return [...remotePane().querySelectorAll<HTMLElement>('[data-sftp-entry]')].map(
    (item) => item.dataset.sftpEntry ?? ''
  )
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-command-confirm]')
}

function dialogButton(name: string): HTMLButtonElement | null {
  return (
    [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (candidate) => candidate.textContent === name
    ) ?? null
  )
}

async function click(element: HTMLElement | null, init: MouseEventInit = {}): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }))
  })
}

function drag(type: string, element: HTMLElement | null, dataTransfer: DataTransfer): void {
  const event = new DragEvent(type, { bubbles: true, cancelable: true })
  // Why: happy-dom's DragEvent ignores `dataTransfer` in its init dict.
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  element?.dispatchEvent(event)
}

/** Drags `from` over `over` and drops it there. */
async function dragAndDrop(from: HTMLElement | null, over: HTMLElement | null): Promise<void> {
  const dataTransfer = new DataTransfer()
  await act(async () => {
    drag('dragstart', from, dataTransfer)
    drag('dragover', over, dataTransfer)
    drag('drop', over, dataTransfer)
  })
}

describe('SftpWorkbench', () => {
  it('downloads only after confirming the exact commands', async () => {
    await click(row('/srv/log.txt'))
    await click(button('Download'))

    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    expect(api.plan).toHaveBeenCalledWith({
      kind: 'download',
      targetId: 'web',
      sources: ['/srv/log.txt'],
      destinationDir: '/Users/dev'
    })
    expect(dialog()?.querySelector('[data-command-list]')?.textContent).toContain(
      'get "/srv/log.txt" "/Users/dev/log.txt"'
    )
    expect(api.execute).not.toHaveBeenCalled()

    await click(dialogButton('Download'))

    await vi.waitFor(() =>
      expect(api.execute).toHaveBeenCalledWith({
        planId: 'plan-download',
        transferId: expect.any(String)
      })
    )
  })

  it('opens a remote folder on double-click', async () => {
    await act(async () => {
      row('/srv/app')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    await vi.waitFor(() => expect(row('/srv/app/index.js')).not.toBeNull())
    expect(api.list).toHaveBeenLastCalledWith({ targetId: 'web', path: '/srv/app' })
  })

  it('deletes only after the user confirms, and drops the plan on cancel', async () => {
    await click(row('/srv/log.txt'))

    await click(button('Delete'))
    await vi.waitFor(() => expect(dialog()).not.toBeNull())
    await click(dialogButton('Cancel'))
    expect(api.execute).not.toHaveBeenCalled()
    expect(api.discardPlan).toHaveBeenCalledWith('plan-remove')

    await click(button('Delete'))
    await vi.waitFor(() => expect(dialogButton('Delete')).not.toBeNull())
    expect(dialog()?.textContent).toContain('rm "/srv/log.txt"')
    await click(dialogButton('Delete'))

    await vi.waitFor(() =>
      expect(api.execute).toHaveBeenCalledWith({
        planId: 'plan-remove',
        transferId: expect.any(String)
      })
    )
  })

  it('goes to the parent folder from the ".." row', async () => {
    await act(async () => {
      remotePane()
        .querySelector('[data-sftp-parent]')
        ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })

    await vi.waitFor(() =>
      expect(api.list).toHaveBeenLastCalledWith({ targetId: 'web', path: '/' })
    )
  })

  it('sorts by a clicked column, folders first, and flips on a second click', async () => {
    expect(remoteRowPaths()).toEqual(['/srv/app', '/srv/big.bin', '/srv/log.txt'])
    const sizeHeader = remotePane().querySelector<HTMLElement>('[data-sftp-column="size"]')

    await click(sizeHeader)
    expect(remoteRowPaths()).toEqual(['/srv/app', '/srv/log.txt', '/srv/big.bin'])

    await click(sizeHeader)
    expect(remoteRowPaths()).toEqual(['/srv/app', '/srv/big.bin', '/srv/log.txt'])
  })

  it('extends a Shift-selection along the displayed order', async () => {
    await click(remotePane().querySelector<HTMLElement>('[data-sftp-column="size"]'))

    await click(row('/srv/app'))
    await click(row('/srv/log.txt'), { shiftKey: true })

    expect(row('/srv/log.txt')?.dataset.selected).toBe('true')
    expect(row('/srv/big.bin')?.dataset.selected).toBeUndefined()
  })

  it('hides a column in both panes when it is switched off', async () => {
    expect(remotePane().querySelector('[data-sftp-column="owner"]')).not.toBeNull()

    await act(async () => useSftpColumnsStore.getState().toggleColumn('owner'))

    expect(document.querySelector('[data-sftp-column="owner"]')).toBeNull()
    expect(document.querySelector('[data-sftp-column="name"]')).not.toBeNull()
  })

  it('resizes a column in both panes from its header divider', async () => {
    const sizeCell = (): HTMLElement | null =>
      row('/Users/dev/report.csv')?.querySelectorAll<HTMLElement>('span[title]')[1] ?? null
    expect(sizeCell()?.style.width).toBe(`${DEFAULT_SFTP_COLUMN_WIDTHS.size}px`)

    await act(async () => {
      remotePane()
        .querySelector('[data-sftp-resize="size"]')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(sizeCell()?.style.width).toBe(`${DEFAULT_SFTP_COLUMN_WIDTHS.size + 16}px`)
  })

  describe('local folder memory', () => {
    async function remount(shownTarget: SshTarget = target): Promise<void> {
      await act(async () => root.unmount())
      vi.clearAllMocks()
      await renderWorkbench(shownTarget)
    }

    async function openLocalFolder(path: string, firstChild: string): Promise<void> {
      await act(async () => {
        row(path)?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
      await vi.waitFor(() => expect(row(firstChild)).not.toBeNull())
    }

    it('reopens the local pane in the last local folder the host showed', async () => {
      await openLocalFolder('/Users/dev/notes', '/Users/dev/notes/todo.md')

      await remount()

      await vi.waitFor(() => expect(row('/Users/dev/notes/todo.md')).not.toBeNull())
      expect(api.localList).toHaveBeenCalledTimes(1)
      expect(api.localList).toHaveBeenCalledWith('/Users/dev/notes')
    })

    it('keeps a separate local folder for each host', async () => {
      await openLocalFolder('/Users/dev/notes', '/Users/dev/notes/todo.md')

      await remount(otherTarget)
      await vi.waitFor(() => expect(row('/Users/dev/report.csv')).not.toBeNull())
      expect(api.localList).toHaveBeenCalledWith('/Users/dev')

      await remount(target)
      await vi.waitFor(() => expect(row('/Users/dev/notes/todo.md')).not.toBeNull())
    })

    it('opens the default local folder for a host without one of its own', async () => {
      saveHostLocalFolder('web', '/Users/dev')
      useSftpDefaultLocalFolder.getState().setDefaultFolder('/Users/dev/notes')

      await remount(otherTarget)

      await vi.waitFor(() => expect(row('/Users/dev/notes/todo.md')).not.toBeNull())
      expect(api.localList).toHaveBeenCalledTimes(1)
      // Opening a host without browsing must not tie it to today's default.
      expect(readHostLocalFolder('db')).toBeNull()
      await remount(target)
      await vi.waitFor(() => expect(row('/Users/dev/report.csv')).not.toBeNull())
    })

    it('falls back to the default folder, then home, when the remembered one is gone', async () => {
      saveHostLocalFolder('web', '/Users/dev/deleted')
      useSftpDefaultLocalFolder.getState().setDefaultFolder('/Users/dev/notes')

      await remount()

      await vi.waitFor(() => expect(row('/Users/dev/notes/todo.md')).not.toBeNull())
      expect(api.localList).toHaveBeenNthCalledWith(1, '/Users/dev/deleted')

      useSftpDefaultLocalFolder.getState().setDefaultFolder('/Users/dev/also-deleted')
      await remount()

      await vi.waitFor(() => expect(row('/Users/dev/report.csv')).not.toBeNull())
      expect(document.body.textContent).not.toContain('ENOENT')
    })

    it('sets and clears the shown local folder as the default for all hosts', async () => {
      await click(button('Set as default local folder for all hosts'))

      expect(useSftpDefaultLocalFolder.getState().defaultFolder).toBe('/Users/dev')
      expect(button('Remove as default local folder').getAttribute('aria-pressed')).toBe('true')

      await click(button('Remove as default local folder'))

      expect(useSftpDefaultLocalFolder.getState().defaultFolder).toBeNull()
    })
  })

  describe('move', () => {
    async function confirmMove(sources: string[], destinationDir: string): Promise<void> {
      await vi.waitFor(() => expect(dialogButton('Move')).not.toBeNull())
      expect(api.plan).toHaveBeenLastCalledWith({
        kind: 'move',
        targetId: 'web',
        sources,
        destinationDir
      })
      await click(dialogButton('Move'))
      await vi.waitFor(() => expect(api.execute).toHaveBeenCalled())
    }

    it('moves the selection to a typed folder, relative to the one shown', async () => {
      await click(row('/srv/log.txt'))
      await click(button('Move to…'))

      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Destination folder"]'
      )
      expect(input?.value).toBe('/srv')
      await act(async () => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
        setValue?.call(input, 'app')
        input?.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => input?.form?.requestSubmit())

      await confirmMove(['/srv/log.txt'], '/srv/app')
    })

    it('moves the dragged selection onto a folder row', async () => {
      await click(row('/srv/log.txt'))
      await click(row('/srv/big.bin'), { metaKey: true, ctrlKey: true })
      const dataTransfer = new DataTransfer()

      await act(async () => {
        drag('dragstart', row('/srv/big.bin'), dataTransfer)
        drag('dragover', row('/srv/app'), dataTransfer)
      })
      expect(row('/srv/app')?.dataset.dropTarget).toBe('true')
      await act(async () => drag('drop', row('/srv/app'), dataTransfer))

      await confirmMove(['/srv/log.txt', '/srv/big.bin'], '/srv/app')
    })

    it('never offers a dragged folder as its own drop target', async () => {
      const dataTransfer = new DataTransfer()

      await act(async () => {
        drag('dragstart', row('/srv/app'), dataTransfer)
        drag('dragover', row('/srv/app'), dataTransfer)
        drag('drop', row('/srv/app'), dataTransfer)
      })

      expect(row('/srv/app')?.dataset.dropTarget).toBeUndefined()
      expect(api.plan).not.toHaveBeenCalled()
    })

    it('selects the right-clicked row and offers the remote actions for it', async () => {
      await click(row('/srv/big.bin'))

      await act(async () => {
        row('/srv/log.txt')?.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
        )
      })

      expect(row('/srv/log.txt')?.dataset.selected).toBe('true')
      expect(row('/srv/big.bin')?.dataset.selected).toBeUndefined()
      const items = [...document.querySelectorAll('[data-slot="context-menu-item"]')].map(
        (item) => item.textContent
      )
      expect(items).toEqual(['Download', 'New folder', 'Rename', 'Move to…', 'Delete'])
    })
  })

  describe('drag between panes', () => {
    function paneDropZone(pane: 'local' | 'remote'): HTMLElement | null {
      return document.querySelector<HTMLElement>(`[data-sftp-pane="${pane}"] [data-sftp-drop-zone]`)
    }

    async function confirmPlan(label: string, request: SftpPlanRequest): Promise<void> {
      await vi.waitFor(() => expect(dialogButton(label)).not.toBeNull())
      expect(api.plan).toHaveBeenLastCalledWith(request)
      await click(dialogButton(label))
      await vi.waitFor(() => expect(api.execute).toHaveBeenCalled())
    }

    it('uploads a local row dropped on the remote pane into the folder it shows', async () => {
      const dataTransfer = new DataTransfer()
      await act(async () => {
        drag('dragstart', row('/Users/dev/report.csv'), dataTransfer)
        drag('dragover', row('/srv/log.txt'), dataTransfer)
      })
      expect(paneDropZone('remote')?.dataset.dropActive).toBe('true')
      await act(async () => drag('drop', row('/srv/log.txt'), dataTransfer))

      await confirmPlan('Upload', {
        kind: 'upload',
        targetId: 'web',
        sources: ['/Users/dev/report.csv'],
        destinationDir: '/srv'
      })
    })

    it('uploads into the remote folder row it is dropped on', async () => {
      await dragAndDrop(row('/Users/dev/report.csv'), row('/srv/app'))

      await confirmPlan('Upload', {
        kind: 'upload',
        targetId: 'web',
        sources: ['/Users/dev/report.csv'],
        destinationDir: '/srv/app'
      })
    })

    it('downloads a remote row dropped on the local pane', async () => {
      await dragAndDrop(row('/srv/log.txt'), row('/Users/dev/report.csv'))

      await confirmPlan('Download', {
        kind: 'download',
        targetId: 'web',
        sources: ['/srv/log.txt'],
        destinationDir: '/Users/dev'
      })
    })

    it('does nothing when a local row is dropped back on the local pane', async () => {
      await dragAndDrop(row('/Users/dev/report.csv'), row('/Users/dev/report.csv'))

      expect(api.plan).not.toHaveBeenCalled()
    })
  })
})
