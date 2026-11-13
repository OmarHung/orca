// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshCommand, SshCommandParam } from '../../../../shared/ssh-command-types'
import type { SshTarget } from '../../../../shared/ssh-types'
import type * as SendModule from './ssh-command-send'
import type { SshCommandTargetCheck } from './ssh-command-send'
import { SshCommandRunDialog } from './SshCommandRunDialog'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  send: vi.fn(),
  focus: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/components/terminal-pane/input/focus/focus-terminal-tab-surface', () => ({
  focusTerminalTabSurface: mocks.focus
}))

vi.mock('./ssh-command-send', async (importOriginal) => {
  const actual = await importOriginal<typeof SendModule>()
  return {
    ...actual,
    checkSshCommandTarget: mocks.check,
    typeSshCommand: mocks.send,
    sshCommandRemotePlatform: () => undefined
  }
})

const target: SshTarget = {
  id: 'web',
  label: 'web-prod',
  host: '203.0.113.10',
  port: 22,
  username: 'deploy'
}

const SERVICE: SshCommandParam = {
  key: 'service',
  label: 'Service',
  kind: 'text',
  defaultValue: 'nginx',
  required: true,
  quote: 'shell'
}

const command: SshCommand = {
  id: 'c1',
  name: 'Tail a service',
  template: 'journalctl -u {{service}}',
  params: [SERVICE],
  runMode: 'insert',
  scope: { type: 'all' }
}

const READY: SshCommandTargetCheck = { kind: 'ready', ptyId: 'pty-1', doubt: null }

let container: HTMLDivElement
let root: Root
const onClose = vi.fn()

async function open(
  overrides: Partial<SshCommand> = {},
  otherTargets: { tabId: string; target: SshTarget }[] = []
): Promise<void> {
  await act(async () =>
    root.render(
      <SshCommandRunDialog
        request={{ command: { ...command, ...overrides }, tabId: 'tab-1', target, otherTargets }}
        onClose={onClose}
      />
    )
  )
}

const db: SshTarget = {
  ...target,
  id: 'db',
  label: 'db-prod',
  host: '203.0.113.20',
  username: 'ops'
}

async function tick(tabId: string): Promise<void> {
  const box = document.querySelector<HTMLElement>(`[data-ssh-command-target="${tabId}"]`)
  await act(async () => box?.click())
}

function preview(): string {
  return document.querySelector('[data-command-list]')?.textContent ?? ''
}

function button(attribute: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[${attribute}]`)
  if (!found) {
    throw new Error(`no ${attribute}`)
  }
  return found
}

async function typeInto(key: string, value: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>(`[data-ssh-command-param="${key}"] input`)
  if (!input) {
    throw new Error(`no field ${key}`)
  }
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.check.mockResolvedValue(READY)
  mocks.send.mockResolvedValue({ isSent: true })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('SshCommandRunDialog', () => {
  it('shows the exact command, from the default value', async () => {
    await open()

    expect(preview()).toContain('journalctl -u nginx')
  })

  it('updates the command as a value is typed, keeping a hostile value as one string', async () => {
    await open()

    await typeInto('service', 'nginx; rm -rf /')

    expect(preview()).toContain("journalctl -u 'nginx; rm -rf /'")
  })

  it('sends exactly what the preview shows, without pressing Enter when pasting', async () => {
    await open()
    await typeInto('service', 'a b')

    await act(async () => button('data-ssh-command-insert').click())

    expect(mocks.send).toHaveBeenCalledWith('tab-1', "journalctl -u 'a b'", 'insert')
    expect(onClose).toHaveBeenCalled()
  })

  it('sends the date and time the preview showed, however long the dialog stays open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 5, 9, 7, 3))
    try {
      await open({ template: 'tar czf {{date}}.tgz {{service}} # {{time}}' })
      vi.setSystemTime(new Date(2026, 10, 6, 1, 0, 0))
      await typeInto('service', 'app')

      expect(preview()).toContain('tar czf 20261105.tgz app # 090703')
      await act(async () => button('data-ssh-command-insert').click())

      expect(mocks.send).toHaveBeenCalledWith(
        'tab-1',
        'tar czf 20261105.tgz app # 090703',
        'insert'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs when asked to', async () => {
    await open()

    await act(async () => button('data-ssh-command-run').click())

    expect(mocks.send).toHaveBeenCalledWith('tab-1', 'journalctl -u nginx', 'run')
  })

  it('stays open, with what was typed, when sending fails', async () => {
    mocks.send.mockResolvedValue({ isSent: false, reason: 'Couldn’t type' })
    await open()
    await typeInto('service', 'kept')

    await act(async () => button('data-ssh-command-run').click())

    expect(onClose).not.toHaveBeenCalled()
    expect(preview()).toContain('journalctl -u kept')
    expect(button('data-ssh-command-run').disabled).toBe(false)
  })

  it('cannot send while a value is missing or unsafe, and says why', async () => {
    await open()

    await typeInto('service', '')
    expect(button('data-ssh-command-run').disabled).toBe(true)
    expect(document.querySelector('[data-ssh-command-problem="missingValue"]')).not.toBeNull()

    await typeInto('service', 'a\u001b[0m')
    expect(button('data-ssh-command-insert').disabled).toBe(true)
    expect(document.querySelector('[data-ssh-command-problem="controlCharacter"]')).not.toBeNull()
  })

  it('cannot send to a tab that is not connected, and says why', async () => {
    mocks.check.mockResolvedValue({ kind: 'blocked', reason: 'localShell' })
    await open()

    expect(button('data-ssh-command-run').disabled).toBe(true)
    expect(button('data-ssh-command-insert').disabled).toBe(true)
    expect(document.querySelector('[data-ssh-command-blocked]')?.textContent).toContain(
      'back on your computer'
    )
  })

  it('cannot send until the tab has been checked', async () => {
    mocks.check.mockReturnValue(new Promise(() => undefined))
    await open()

    expect(button('data-ssh-command-run').disabled).toBe(true)
  })

  it('warns on an unverifiable tab, yet lets the user decide', async () => {
    mocks.check.mockResolvedValue({ kind: 'ready', ptyId: 'pty-1', doubt: 'noSshEvidence' })
    await open()

    expect(document.body.textContent).toContain('can’t confirm this tab is still connected')
    expect(button('data-ssh-command-run').disabled).toBe(false)
  })

  it('warns that a hand-started ssh may be on another host, yet lets the user decide', async () => {
    mocks.check.mockResolvedValue({ kind: 'ready', ptyId: 'pty-1', doubt: 'manualSsh' })
    await open()

    expect(document.querySelector('[data-ssh-command-doubt="manualSsh"]')).not.toBeNull()
    expect(button('data-ssh-command-run').disabled).toBe(false)
  })

  it('never puts focus on a button that sends, so Enter cannot run it by accident', async () => {
    await open({ template: 'uptime', params: [], runMode: 'run' })

    expect(document.activeElement?.hasAttribute('data-ssh-command-run')).toBe(false)
    expect(document.activeElement?.hasAttribute('data-ssh-command-insert')).toBe(false)
  })

  it('warns about a value that may read as an option, and still allows it', async () => {
    await open()

    await typeInto('service', '--all')

    expect(document.body.textContent).toContain('starts with a dash')
    expect(button('data-ssh-command-run').disabled).toBe(false)
  })

  it('marks a value that goes in without quotes', async () => {
    await open({ params: [{ ...SERVICE, quote: 'raw' }] })

    expect(document.body.textContent).toContain('Inserted as written')
  })

  it('offers the value used last, instead of the default', async () => {
    await open()
    await typeInto('service', 'postgres')
    await act(async () => button('data-ssh-command-insert').click())
    await act(async () => root.unmount())
    root = createRoot(container)

    await open()

    expect(preview()).toContain('journalctl -u postgres')
  })

  describe('in a grid', () => {
    const others = [{ tabId: 'tab-2', target: db }]

    it('sends to the current tab only, until another host is ticked', async () => {
      await open({}, others)

      await act(async () => button('data-ssh-command-run').click())

      expect(mocks.send).toHaveBeenCalledTimes(1)
      expect(mocks.send).toHaveBeenCalledWith('tab-1', 'journalctl -u nginx', 'run')
    })

    it('shows and sends each host its own command', async () => {
      await open({ template: 'echo {{host}} {{user}}', params: [] }, others)

      await tick('tab-2')

      const preview = document.querySelector('[data-ssh-command-multi-preview]')?.textContent
      expect(preview).toContain('echo 203.0.113.10 deploy')
      expect(preview).toContain('echo 203.0.113.20 ops')

      await act(async () => button('data-ssh-command-run').click())

      expect(mocks.send.mock.calls).toEqual([
        ['tab-1', 'echo 203.0.113.10 deploy', 'run'],
        ['tab-2', 'echo 203.0.113.20 ops', 'run']
      ])
      expect(onClose).toHaveBeenCalled()
    })

    it('says how many hosts Run reaches', async () => {
      await open({}, others)

      await tick('tab-2')

      expect(button('data-ssh-command-run').textContent).toContain('2')
    })

    it('skips a host that is not connected, and still sends to the rest', async () => {
      mocks.check.mockImplementation(async (tabId: string) =>
        tabId === 'tab-2' ? { kind: 'blocked', reason: 'localShell' } : READY
      )
      await open({}, others)
      await act(async () => undefined)

      await tick('tab-2')
      expect(
        document.querySelector('[data-ssh-command-multi-preview] [data-skipped="true"]')
      ).not.toBeNull()

      await act(async () => button('data-ssh-command-run').click())

      expect(mocks.send).toHaveBeenCalledTimes(1)
      expect(mocks.send).toHaveBeenCalledWith('tab-1', 'journalctl -u nginx', 'run')
    })

    it('refuses the files pane on several hosts, since it belongs to one tab', async () => {
      await open({ template: 'ls {{path}}', params: [] }, others)

      await tick('tab-2')

      expect(document.querySelector('[data-ssh-command-problem="singleTargetOnly"]')).not.toBeNull()
      expect(button('data-ssh-command-run').disabled).toBe(true)
    })

    it('can reach another host alone, without the current tab', async () => {
      await open({ template: 'echo {{host}}', params: [] }, others)

      await tick('tab-2')
      await tick('tab-1')
      await act(async () => button('data-ssh-command-run').click())

      expect(mocks.send.mock.calls).toEqual([['tab-2', 'echo 203.0.113.20', 'run']])
    })

    it('names the host that gets it when only another one is ticked', async () => {
      await open({ template: 'uptime', params: [] }, others)

      await tick('tab-2')
      await tick('tab-1')

      const description = document.querySelector('[data-ssh-command-run-dialog] p')?.textContent
      expect(description).toContain('db-prod')
      expect(description).not.toContain('web-prod')
      expect(document.querySelector('[data-ssh-command-multi-preview]')?.textContent).toContain(
        'db-prod'
      )
    })

    it('leaves the keyboard on the pane in use, even if it was not sent to', async () => {
      await open({ template: 'uptime', params: [] }, others)
      await tick('tab-2')
      await tick('tab-1')

      await act(async () => button('data-ssh-command-run').click())

      expect(mocks.focus.mock.calls).toEqual([['tab-1']])
    })

    it('names each host that missed it, and closes when another got it', async () => {
      mocks.send.mockImplementation(async (tabId: string) =>
        tabId === 'tab-2' ? { isSent: false, reason: 'Couldn’t type' } : { isSent: true }
      )
      await open({ template: 'uptime', params: [] }, others)
      await tick('tab-2')

      await act(async () => button('data-ssh-command-run').click())

      expect(mocks.toastError).toHaveBeenCalledWith('db-prod: Couldn’t type')
      expect(onClose).toHaveBeenCalled()
    })

    it('says the command may run on this computer, also in a grid', async () => {
      mocks.check.mockResolvedValue({ kind: 'ready', ptyId: 'pty-1', doubt: 'noSshEvidence' })

      await open({}, others)

      expect(document.querySelector('[data-ssh-command-doubt="noSshEvidence"]')).not.toBeNull()
      expect(document.body.textContent).toContain('runs on your computer')
    })

    it('sends nothing with no host ticked', async () => {
      await open({}, others)

      await tick('tab-1')

      expect(button('data-ssh-command-run').disabled).toBe(true)
    })
  })

  it('does not ask for a parameter the template no longer uses', async () => {
    await open({ template: 'uptime', params: [{ ...SERVICE, label: 'Old' }] })

    expect(document.querySelector('[data-ssh-command-param]')).toBeNull()
    expect(preview()).toContain('uptime')
  })
})
