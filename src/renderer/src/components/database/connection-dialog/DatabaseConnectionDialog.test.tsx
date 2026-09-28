// @vitest-environment happy-dom

import { act, createContext, createElement, useContext, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseConnectionDialog } from './DatabaseConnectionDialog'

const mocks = vi.hoisted(() => ({ labels: new Map<string, string>() }))

vi.mock('@/store', () => {
  const state = (): { sshTargetLabels: Map<string, string> } => ({
    sshTargetLabels: mocks.labels
  })
  return {
    useAppStore: Object.assign(
      (selector: (current: ReturnType<typeof state>) => unknown) => selector(state()),
      { getState: state }
    )
  }
})

// Why: Radix Select needs real pointer events to open; buttons that pick their value are enough here.
const PickContext = createContext<(value: string) => void>(() => {})
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange
  }: {
    children?: ReactNode
    onValueChange: (value: string) => void
  }) => createElement(PickContext.Provider, { value: onValueChange }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  SelectItem: function SelectItem({ children, value }: { children?: ReactNode; value: string }) {
    const pick = useContext(PickContext)
    return createElement('button', { type: 'button', onClick: () => pick(value) }, children)
  }
}))

vi.mock('../../sidebar/AddRemoteHostDialog', () => ({
  AddRemoteHostDialog: ({
    mode,
    onOpenChange
  }: {
    mode: 'ssh' | 'server' | null
    onOpenChange: (mode: null) => void
  }) =>
    mode === null
      ? null
      : createElement(
          'form',
          { onSubmit: (event: Event) => event.preventDefault() },
          createElement('button', { type: 'submit' }, 'Stub submit'),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                mocks.labels = new Map([...mocks.labels, ['target-new', 'bastion']])
                onOpenChange(null)
              }
            },
            'Stub save'
          ),
          createElement(
            'button',
            {
              type: 'button',
              onClick: () => {
                mocks.labels = new Map([...mocks.labels, ['target-a', 'a'], ['target-b', 'b']])
                onOpenChange(null)
              }
            },
            'Stub add all'
          ),
          createElement(
            'button',
            { type: 'button', onClick: () => onOpenChange(null) },
            'Stub cancel'
          )
        )
}))

const SSH_HINT = 'Host and port are as seen from the SSH host'
const SSH_EMPTY = 'No saved SSH hosts yet.'

let root: Root | null = null
let saveConnection: ReturnType<typeof vi.fn>

beforeEach(() => {
  mocks.labels = new Map()
  saveConnection = vi.fn(async () => ({ ok: false, error: { message: 'not in this test' } }))
  vi.stubGlobal('api', {
    database: {
      encryptionStatus: vi.fn(async () => ({ canStorePasswords: true })),
      saveConnection
    }
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
  }
  root = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

async function renderDialog(onClose: () => void = vi.fn()): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<DatabaseConnectionDialog existing={null} onClose={onClose} />)
  })
  // Why: Radix attaches its document pointerdown listener on a setTimeout(0).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function clickButton(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === text
  )
  if (!button) {
    throw new Error(`No button "${text}"`)
  }
  await act(async () => {
    button.click()
  })
}

describe('DatabaseConnectionDialog', () => {
  it('stays open when the user clicks outside it', async () => {
    const onClose = vi.fn()
    await renderDialog(onClose)

    await act(async () => {
      document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true })
      )
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes from the Cancel button', async () => {
    const onClose = vi.fn()
    await renderDialog(onClose)

    await clickButton('Cancel')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tunnels through the SSH host added from the SSH tunnel list', async () => {
    await renderDialog()
    expect(document.body.textContent).toContain(SSH_EMPTY)

    await clickButton('Add SSH host…')
    await clickButton('Stub save')

    expect(document.body.textContent).toContain(SSH_HINT)
    expect(document.body.textContent).not.toContain('Stub save')
  })

  it('keeps the tunnel choice when adding an SSH host is cancelled', async () => {
    await renderDialog()

    await clickButton('Add SSH host…')
    await clickButton('Stub cancel')

    expect(document.body.textContent).toContain(SSH_EMPTY)
    expect(document.body.textContent).not.toContain('Removed SSH host')
  })

  it('picks no host when several were added at once', async () => {
    await renderDialog()

    await clickButton('Add SSH host…')
    await clickButton('Stub add all')

    expect(document.body.textContent).not.toContain(SSH_HINT)
  })

  it('does not save the connection when the SSH host form is submitted', async () => {
    await renderDialog()

    await clickButton('Add SSH host…')
    await clickButton('Stub submit')

    expect(saveConnection).not.toHaveBeenCalled()
  })
})
