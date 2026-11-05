// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshCommand } from '../../../../shared/ssh-command-types'
import { useSshCommandsStore } from './ssh-commands-store'
import { SshCommandEditDialog } from './SshCommandEditDialog'

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), save: vi.fn() }))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

let container: HTMLDivElement
let root: Root
const onClose = vi.fn()

async function open(command: SshCommand | null): Promise<void> {
  await act(async () =>
    root.render(<SshCommandEditDialog request={{ command }} targets={[]} onClose={onClose} />)
  )
}

function field(id: string): HTMLInputElement | HTMLTextAreaElement {
  const found = document.getElementById(id)
  if (found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement) {
    return found
  }
  throw new Error(`no field ${id}`)
}

async function type(id: string, value: string): Promise<void> {
  const element = field(id)
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function paramKeys(): (string | null)[] {
  return [...document.querySelectorAll('[data-ssh-command-param-row]')].map((row) =>
    row.getAttribute('data-ssh-command-param-row')
  )
}

function saveButton(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>('[data-ssh-command-save]')
  if (!found) {
    throw new Error('no save button')
  }
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({})
  useSshCommandsStore.setState({ save: mocks.save })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('SshCommandEditDialog', () => {
  it('adds a row for each parameter as it is typed', async () => {
    await open(null)

    await type('ssh-command-template', 'journalctl -u {{service}} -n {{lines}}')

    expect(paramKeys()).toEqual(['service', 'lines'])
  })

  it('leaves built-in values out of the rows', async () => {
    await open(null)

    await type('ssh-command-template', 'ls {{path}} {{host}}')

    expect(paramKeys()).toEqual([])
  })

  it('cannot save without a name and a command', async () => {
    await open(null)
    expect(saveButton().disabled).toBe(true)

    await type('ssh-command-name', 'List')
    expect(saveButton().disabled).toBe(true)

    await type('ssh-command-template', 'ls')
    expect(saveButton().disabled).toBe(false)
  })

  it('saves what was typed, pasting by default, and closes', async () => {
    await open(null)
    await type('ssh-command-name', 'List')
    await type('ssh-command-template', 'ls {{dir}}')

    await act(async () => saveButton().click())

    expect(mocks.save).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        name: 'List',
        template: 'ls {{dir}}',
        runMode: 'insert',
        scope: { type: 'all' },
        params: [expect.objectContaining({ key: 'dir', quote: 'shell', required: true })]
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps a filled-in parameter marked unused when it leaves the template', async () => {
    await open({
      id: 'c1',
      name: 'List',
      template: 'ls {{dir}}',
      params: [
        {
          key: 'dir',
          label: 'Folder',
          kind: 'text',
          defaultValue: '/srv',
          required: true,
          quote: 'shell'
        }
      ],
      runMode: 'insert',
      scope: { type: 'all' }
    })

    await type('ssh-command-template', 'ls')

    expect(paramKeys()).toEqual(['dir'])
    expect(document.body.textContent).toContain('Not used')
  })

  it('cannot save a parameter inside quotes, and says why', async () => {
    await open(null)
    await type('ssh-command-name', 'Find')

    await type('ssh-command-template', 'grep "{{word}}" app.log')

    expect(document.querySelector('[data-ssh-command-draft-problem="quotedKey"]')).not.toBeNull()
    expect(saveButton().disabled).toBe(true)
  })

  it('says how several lines are joined', async () => {
    await open(null)

    await type('ssh-command-template', 'cd /srv\nls')

    expect(document.querySelector('[data-ssh-command-multiline]')).not.toBeNull()
  })

  it('points out double braces that go out as written', async () => {
    await open(null)

    await type('ssh-command-template', "docker ps --format '{{.Names}}'")

    expect(document.querySelector('[data-ssh-command-literal]')?.textContent).toContain(
      '{{.Names}}'
    )
    expect(paramKeys()).toEqual([])
  })

  it('stays open with what was typed when saving fails', async () => {
    mocks.save.mockRejectedValue(new Error('disk full'))
    await open(null)
    await type('ssh-command-name', 'List')
    await type('ssh-command-template', 'ls')

    await act(async () => saveButton().click())

    expect(onClose).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('disk full')
    expect(field('ssh-command-name').value).toBe('List')
    expect(saveButton().disabled).toBe(false)
  })

  it('shows the placeholders it explains, instead of filling them in', async () => {
    await open(null)

    expect(document.body.textContent).toContain(
      '{{host}} {{user}} {{path}} {{selected}} {{date}} {{time}}'
    )
  })
})
