// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseConnectionDialog } from './DatabaseConnectionDialog'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: { sshTargetLabels: Map<string, string> }) => unknown) =>
    selector({ sshTargetLabels: new Map() })
}))

let root: Root | null = null

beforeEach(() => {
  vi.stubGlobal('api', {
    database: {
      encryptionStatus: vi.fn(async () => ({ canStorePasswords: true }))
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

async function renderDialog(onClose: () => void): Promise<void> {
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

    const cancel = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Cancel'
    )
    await act(async () => {
      cancel?.click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
