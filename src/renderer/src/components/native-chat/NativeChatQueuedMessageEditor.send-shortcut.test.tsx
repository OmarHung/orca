// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../shared/constants'
import { NativeChatQueuedMessageEditor } from './NativeChatQueuedMessageEditor'
import type { QueuedMessageInlineEditor } from './use-structured-agent-session-queued-edit'

function setup() {
  const editor: QueuedMessageInlineEditor = {
    messageId: 'mail',
    text: 'full message',
    acquiring: false,
    saving: false,
    canSave: true,
    change: vi.fn(),
    save: vi.fn(),
    cancel: vi.fn()
  }
  const parent = vi.fn()
  render(
    <div onKeyDown={parent}>
      <NativeChatQueuedMessageEditor editor={editor} />
    </div>
  )
  return {
    save: editor.save,
    parent,
    /** True when the handler claimed the key, which keeps the new line out of the field. */
    press: (init: KeyboardEventInit = {}) =>
      !fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', ...init })
  }
}

beforeEach(() => {
  useAppStore.setState({ settings: getDefaultSettings('/tmp') })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAppStore.setState({ settings: null })
})

describe('queued message editor send shortcut', () => {
  it('Enter adds a line without saving, and stays away from an open prompt card', () => {
    const { press, save, parent } = setup()
    expect(press()).toBe(false)
    expect(save).not.toHaveBeenCalled()
    expect(parent).not.toHaveBeenCalled()
  })

  it.each([
    ['Macintosh', { metaKey: true }, { ctrlKey: true }],
    ['Windows NT', { ctrlKey: true }, { metaKey: true }],
    ['X11; Linux', { ctrlKey: true }, { metaKey: true }]
  ])("saves only on %s's chord", (userAgent, chord, otherModifier) => {
    vi.stubGlobal('navigator', { userAgent })
    const { press, save } = setup()
    press(otherModifier)
    expect(save).not.toHaveBeenCalled()
    expect(press(chord)).toBe(true)
    expect(save).toHaveBeenCalledOnce()
  })

  it('turning the setting off saves on Enter again', () => {
    useAppStore.setState({
      settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithShortcutOnly: false }
    })
    const { press, save } = setup()
    expect(press()).toBe(true)
    expect(save).toHaveBeenCalledOnce()
  })
})
