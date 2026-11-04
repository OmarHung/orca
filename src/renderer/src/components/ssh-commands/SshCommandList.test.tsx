// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshCommand } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import { useRemoteSessionStore } from '../ssh-page/remote-session-store'
import { TooltipProvider } from '../ui/tooltip'
import type * as SendModule from './ssh-command-send'
import { useSshCommandsStore } from './ssh-commands-store'
import { SshCommandList } from './SshCommandList'

const mocks = vi.hoisted(() => {
  const quickCommands: unknown[] = []
  return {
    send: vi.fn(async (): Promise<boolean> => true),
    check: vi.fn(),
    confirm: vi.fn(async (): Promise<boolean> => true),
    toastInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    quickCommands
  }
})

vi.mock('sonner', () => ({
  toast: { info: mocks.toastInfo, success: mocks.toastSuccess, error: mocks.toastError }
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({ settings: { terminalQuickCommands: mocks.quickCommands } })
}))
vi.mock('../command-confirm/command-confirm-context', () => ({
  useCommandConfirm: () => mocks.confirm
}))
vi.mock('./ssh-command-send', async (importOriginal) => {
  const actual = await importOriginal<typeof SendModule>()
  return {
    ...actual,
    sendSshCommand: mocks.send,
    checkSshCommandTarget: mocks.check,
    sshCommandRemotePlatform: () => undefined,
    sshCommandBuiltins: () => ({ host: 'h', user: 'u', path: null, selected: [] })
  }
})

const web: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

function command(id: string, overrides: Partial<SshCommand> = {}): SshCommand {
  return {
    id,
    name: id,
    template: 'uptime',
    params: [],
    runMode: 'insert',
    scope: { type: 'all' },
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root
const list = vi.fn()
const remove = vi.fn()
const save = vi.fn()

async function show(
  commands: SshCommand[],
  activeTabId: string | null = 'tab-1',
  activeTarget: SshTarget | null = web
): Promise<void> {
  list.mockResolvedValue({ ok: true, value: commands })
  await act(async () =>
    root.render(
      <TooltipProvider>
        <SshCommandList activeTabId={activeTabId} activeTarget={activeTarget} targets={[web]} />
      </TooltipProvider>
    )
  )
}

function rowIds(): (string | null)[] {
  return [...document.querySelectorAll('[data-ssh-command-row]')].map((row) =>
    row.getAttribute('data-ssh-command-row')
  )
}

async function click(id: string): Promise<void> {
  const row = document.querySelector(`[data-ssh-command-row="${id}"] button`)
  if (!(row instanceof HTMLButtonElement)) {
    throw new Error(`no row ${id}`)
  }
  await act(async () => row.click())
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.quickCommands = []
  mocks.confirm.mockResolvedValue(true)
  mocks.check.mockResolvedValue({ kind: 'ready', ptyId: 'pty-1', doubt: null })
  remove.mockResolvedValue({ ok: true, value: null })
  save.mockImplementation(async ({ draft }) => ({
    ok: true,
    value: { ...draft, id: `saved-${draft.name}` }
  }))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { sshCommands: { list, save, delete: remove } }
  })
  useSshCommandsStore.setState({ commands: [], status: 'idle', error: null })
  useRemoteSessionStore.setState({ grid: null, sessions: {} })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('SshCommandList', () => {
  it('puts commands for this host first, and shows others apart from them', async () => {
    await show([
      command('elsewhere', { scope: { type: 'hosts', targetIds: ['other'] } }),
      command('here', { scope: { type: 'hosts', targetIds: ['web'] } })
    ])

    expect(rowIds()).toEqual(['here', 'elsewhere'])
    expect(document.body.textContent).toContain('For other hosts')
  })

  it('does not offer a command meant for another host, which can still be edited', async () => {
    await show([command('elsewhere', { scope: { type: 'hosts', targetIds: ['other'] } })])

    await click('elsewhere')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-ssh-command-run-dialog]')).toBeNull()
    expect(document.querySelector('[data-ssh-command-edit]')).not.toBeNull()
  })

  it('pastes straight away when there is nothing to fill in and Enter is not pressed', async () => {
    await show([command('plain')])

    await click('plain')

    expect(mocks.send).toHaveBeenCalledWith('tab-1', 'uptime', 'insert')
    expect(document.querySelector('[data-ssh-command-run-dialog]')).toBeNull()
  })

  it('shows the command first when the tab might not be on this host', async () => {
    mocks.check.mockResolvedValue({ kind: 'ready', ptyId: 'pty-1', doubt: 'manualSsh' })
    await show([command('plain')])

    await click('plain')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-ssh-command-doubt="manualSsh"]')).not.toBeNull()
  })

  it('opens the dialog in a grid, where other hosts can be chosen', async () => {
    const other: SshTarget = { ...web, id: 'db', label: 'db-prod' }
    useRemoteSessionStore.setState({
      grid: { tabIds: ['tab-1', 'tab-2'], layout: 'terminal', dockHeight: 280 },
      sessions: {
        'tab-1': {
          tabId: 'tab-1',
          targetId: 'web',
          layout: 'terminal',
          dockHeight: 280,
          terminalStarted: true
        },
        'tab-2': {
          tabId: 'tab-2',
          targetId: 'db',
          layout: 'terminal',
          dockHeight: 280,
          terminalStarted: true
        }
      }
    })
    list.mockResolvedValue({ ok: true, value: [command('plain')] })
    await act(async () =>
      root.render(
        <TooltipProvider>
          <SshCommandList activeTabId="tab-1" activeTarget={web} targets={[web, other]} />
        </TooltipProvider>
      )
    )

    await click('plain')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-ssh-command-target="tab-2"]')).not.toBeNull()
  })

  it('always shows the command first when it would run', async () => {
    await show([command('runs', { runMode: 'run' })])

    await click('runs')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-ssh-command-run-dialog]')).not.toBeNull()
  })

  it('asks for the values when there are some to fill in', async () => {
    await show([
      command('asks', {
        template: 'ls {{dir}}',
        params: [
          {
            key: 'dir',
            label: 'Folder',
            kind: 'text',
            defaultValue: '',
            required: true,
            quote: 'shell'
          }
        ]
      })
    ])

    await click('asks')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-ssh-command-param="dir"]')).not.toBeNull()
  })

  it('opens the dialog when a built-in value is missing, instead of sending a broken command', async () => {
    await show([command('needs-folder', { template: 'ls {{path}}' })])

    await click('needs-folder')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(document.querySelector('[data-ssh-command-problem="noPath"]')).not.toBeNull()
  })

  it('needs a tab to send to', async () => {
    await show([command('plain')], null, null)

    await click('plain')

    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.toastInfo).toHaveBeenCalledTimes(1)
  })

  it('finds commands by name or by what they run', async () => {
    await show([command('logs', { template: 'journalctl' }), command('disk', { template: 'df' })])
    const search = document.querySelector<HTMLInputElement>('input')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set

    await act(async () => {
      setValue?.call(search, 'journal')
      search?.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(rowIds()).toEqual(['logs'])
  })

  it('deletes only after confirming', async () => {
    mocks.confirm.mockResolvedValue(false)
    await show([command('plain')])
    const deleteButton = document.querySelector<HTMLButtonElement>('[data-ssh-command-delete]')

    await act(async () => deleteButton?.click())
    expect(remove).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValue(true)
    await act(async () => deleteButton?.click())
    expect(remove).toHaveBeenCalledWith('plain')
    expect(rowIds()).toEqual([])
  })

  it('imports Quick Commands once, then stops offering it', async () => {
    mocks.quickCommands = [{ id: 'q', label: 'Uptime', command: 'uptime', appendEnter: true }]
    await show([])
    const importButton = (): HTMLButtonElement | null =>
      document.querySelector('[data-ssh-command-action="import"]')

    await act(async () => importButton()?.click())

    expect(save).toHaveBeenCalledTimes(1)
    expect(rowIds()).toEqual(['saved-Uptime'])
    expect(importButton()).toBeNull()
  })

  it('shows why the saved commands could not be read', async () => {
    list.mockResolvedValue({ ok: false, error: 'not valid JSON' })
    await act(async () =>
      root.render(
        <TooltipProvider>
          <SshCommandList activeTabId="tab-1" activeTarget={web} targets={[web]} />
        </TooltipProvider>
      )
    )

    expect(document.body.textContent).toContain('not valid JSON')
  })
})
