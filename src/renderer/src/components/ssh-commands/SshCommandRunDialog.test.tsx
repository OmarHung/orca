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
  send: vi.fn(async (): Promise<boolean> => true)
}))

vi.mock('./ssh-command-send', async (importOriginal) => {
  const actual = await importOriginal<typeof SendModule>()
  return {
    ...actual,
    checkSshCommandTarget: mocks.check,
    sendSshCommand: mocks.send,
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

async function open(overrides: Partial<SshCommand> = {}): Promise<void> {
  await act(async () =>
    root.render(
      <SshCommandRunDialog
        request={{ command: { ...command, ...overrides }, tabId: 'tab-1', target }}
        onClose={onClose}
      />
    )
  )
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
  mocks.send.mockResolvedValue(true)
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

  it('runs when asked to', async () => {
    await open()

    await act(async () => button('data-ssh-command-run').click())

    expect(mocks.send).toHaveBeenCalledWith('tab-1', 'journalctl -u nginx', 'run')
  })

  it('stays open, with what was typed, when sending fails', async () => {
    mocks.send.mockResolvedValue(false)
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

  it('does not ask for a parameter the template no longer uses', async () => {
    await open({ template: 'uptime', params: [{ ...SERVICE, label: 'Old' }] })

    expect(document.querySelector('[data-ssh-command-param]')).toBeNull()
    expect(preview()).toContain('uptime')
  })
})
