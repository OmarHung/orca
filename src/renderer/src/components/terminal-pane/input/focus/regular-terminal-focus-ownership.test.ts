// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REGULAR_TERMINAL_INPUT_FOCUSED_ATTRIBUTE,
  releaseTerminalFocusForOutsidePointerDown
} from './regular-terminal-focus-ownership'

function appendPane(): HTMLDivElement {
  const pane = document.createElement('div')
  document.body.appendChild(pane)
  return pane
}

function appendHelper(pane: HTMLElement): HTMLTextAreaElement {
  const helper = document.createElement('textarea')
  helper.className = 'xterm-helper-textarea'
  pane.appendChild(helper)
  return helper
}

describe('regular terminal focus ownership', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    document.documentElement.removeAttribute(REGULAR_TERMINAL_INPUT_FOCUSED_ATTRIBUTE)
  })

  it('keeps ownership for pointerdowns inside the portaled terminal link popover', () => {
    const pane = appendPane()
    const helper = appendHelper(pane)
    const popover = document.createElement('div')
    popover.setAttribute('data-terminal-link-action-popover', '')
    const row = document.createElement('button')
    popover.appendChild(row)
    document.body.appendChild(popover)
    const syncFocused = vi.fn()
    const blur = vi.spyOn(helper, 'blur')
    helper.focus()

    const released = releaseTerminalFocusForOutsidePointerDown({
      container: pane,
      activeElement: document.activeElement,
      pointerTarget: row,
      syncFocused
    })

    expect(released).toBe(false)
    expect(syncFocused).not.toHaveBeenCalled()
    expect(blur).not.toHaveBeenCalled()
  })
})
