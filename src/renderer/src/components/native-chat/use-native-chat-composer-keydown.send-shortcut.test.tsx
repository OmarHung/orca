// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  applyMentionSuggestion,
  applyPickerSuggestion,
  type ComposerAutocomplete,
  type NativeChatPickerItem
} from '../../../../shared/native-chat-composer-autocomplete'
import { useNativeChatComposerKeyDown } from './use-native-chat-composer-keydown'

const COMMAND: NativeChatPickerItem = {
  kind: 'command',
  id: 'command:clear',
  name: 'clear',
  token: '/clear',
  description: 'Clear history',
  skillCollision: false
}

const SKILL: NativeChatPickerItem = {
  kind: 'skill',
  id: 'skill:review',
  name: 'review',
  token: '/review',
  description: 'Review the diff',
  sources: []
}

function slashMenu(items: NativeChatPickerItem[]): ComposerAutocomplete {
  return {
    mode: 'slash',
    query: '',
    items,
    triggerKey: '/:0',
    prefix: '/',
    dispatchable: true,
    grouped: false,
    commandsEnabled: true,
    skillsEnabled: true,
    skillStatus: 'ready'
  }
}

const MENTION_MENU: ComposerAutocomplete = { mode: 'mention', query: 'in', triggerKey: '@:5' }

function setup({
  autocomplete = { mode: 'none' },
  initialDraft = 'hello',
  files = [],
  steerQueued
}: {
  autocomplete?: ComposerAutocomplete
  initialDraft?: string
  files?: readonly string[]
  steerQueued?: () => boolean
} = {}) {
  const sent = vi.fn()
  const dispatched = vi.fn()

  function Composer(): React.JSX.Element {
    const [draft, setDraft] = useState(initialDraft)
    const onKeyDown = useNativeChatComposerKeyDown({
      autocomplete,
      mentionFiles: { files, loading: false, failed: false },
      completeMention: (path) => setDraft(applyMentionSuggestion(draft, draft.length, path).draft),
      activeSuggestion: 0,
      draft,
      isComposing: () => false,
      completePickerItem: (item) =>
        setDraft(applyPickerSuggestion(draft, draft.length, item).draft),
      dispatchPickerCommand: dispatched,
      dismissPicker: vi.fn(),
      interrupt: vi.fn(),
      send: () => sent(draft),
      ...(steerQueued ? { steerQueued } : {}),
      setActiveSuggestion: vi.fn(),
      setDraft,
      setCaret: vi.fn()
    })
    return <div role="textbox" aria-label={draft} onKeyDown={onKeyDown} />
  }

  render(<Composer />)
  return {
    sent,
    dispatched,
    draft: () => screen.getByRole('textbox').getAttribute('aria-label'),
    /** True when the handler claimed the key, which keeps it from the editor. */
    press: (init: KeyboardEventInit = {}) =>
      !fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 13, ...init })
  }
}

const CHORD = { metaKey: true }

beforeEach(() => {
  useAppStore.setState({ settings: getDefaultSettings('/tmp') })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useAppStore.setState({ settings: null })
})

describe('composer send shortcut', () => {
  describe.each([
    ['Macintosh', { metaKey: true }, { ctrlKey: true }],
    ['Windows NT', { ctrlKey: true }, { metaKey: true }],
    ['X11; Linux', { ctrlKey: true }, { metaKey: true }]
  ])('on %s', (userAgent, chord, otherModifier) => {
    it("sends only on the platform's chord", () => {
      vi.stubGlobal('navigator', { userAgent })
      const { press, sent } = setup()

      expect(press(otherModifier)).toBe(false)
      expect(sent).not.toHaveBeenCalled()

      expect(press(chord)).toBe(true)
      expect(sent).toHaveBeenCalledExactlyOnceWith('hello')
    })
  })

  describe('with the platform set to Mac', () => {
    const onMac = () => vi.stubGlobal('navigator', { userAgent: 'Macintosh' })

    it('turning the setting off sends and runs commands on Enter again', () => {
      onMac()
      useAppStore.setState({
        settings: { ...getDefaultSettings('/tmp'), nativeChatSendWithShortcutOnly: false }
      })
      const typed = setup()
      expect(typed.press()).toBe(true)
      expect(typed.sent).toHaveBeenCalledExactlyOnceWith('hello')
      cleanup()

      const menu = setup({ autocomplete: slashMenu([COMMAND]), initialDraft: '/' })
      expect(menu.press()).toBe(true)
      expect(menu.dispatched).toHaveBeenCalledExactlyOnceWith(COMMAND)
    })

    it('leaves plain and Shift+Enter to the editor as a new line', () => {
      onMac()
      const { press, sent } = setup()
      expect(press()).toBe(false)
      expect(press({ shiftKey: true })).toBe(false)
      expect(sent).not.toHaveBeenCalled()
    })

    it('Enter completes a leading command instead of running it', () => {
      onMac()
      const { press, sent, dispatched, draft } = setup({
        autocomplete: slashMenu([COMMAND]),
        initialDraft: '/'
      })
      expect(press()).toBe(true)
      expect(draft()).toBe('/clear ')
      expect(dispatched).not.toHaveBeenCalled()
      expect(sent).not.toHaveBeenCalled()
    })

    it('the chord runs a leading command', () => {
      onMac()
      const { press, sent, dispatched } = setup({
        autocomplete: slashMenu([COMMAND]),
        initialDraft: '/'
      })
      expect(press(CHORD)).toBe(true)
      expect(dispatched).toHaveBeenCalledExactlyOnceWith(COMMAND)
      expect(sent).not.toHaveBeenCalled()
    })

    it('Enter completes a skill without sending it', () => {
      onMac()
      const { press, sent, draft } = setup({
        autocomplete: slashMenu([SKILL]),
        initialDraft: '/'
      })
      expect(press()).toBe(true)
      expect(draft()).toBe('/review ')
      expect(sent).not.toHaveBeenCalled()
    })

    it('the chord picks the skill and sends the completed draft, not the typed one', () => {
      onMac()
      const { press, sent } = setup({
        autocomplete: slashMenu([SKILL]),
        initialDraft: '/'
      })
      expect(press(CHORD)).toBe(true)
      expect(sent).toHaveBeenCalledExactlyOnceWith('/review ')
    })

    it('the chord picks the file and sends the completed draft', () => {
      onMac()
      const { press, sent } = setup({
        autocomplete: MENTION_MENU,
        initialDraft: 'see @in',
        files: ['src/index.ts']
      })
      expect(press(CHORD)).toBe(true)
      expect(sent).toHaveBeenCalledExactlyOnceWith('see @src/index.ts ')
    })

    it('a menu with nothing to pick still sends only on the chord', () => {
      onMac()
      const { press, sent } = setup({ autocomplete: slashMenu([]), initialDraft: '/nope' })
      expect(press()).toBe(false)
      expect(sent).not.toHaveBeenCalled()
      expect(press(CHORD)).toBe(true)
      expect(sent).toHaveBeenCalledExactlyOnceWith('/nope')
    })

    it('the chord still steers from an empty composer, and Enter never does', () => {
      onMac()
      const steerQueued = vi.fn(() => true)
      const { press, sent } = setup({ initialDraft: '', steerQueued })
      expect(press()).toBe(false)
      expect(steerQueued).not.toHaveBeenCalled()
      expect(press(CHORD)).toBe(true)
      expect(steerQueued).toHaveBeenCalledTimes(1)
      expect(sent).not.toHaveBeenCalled()
    })
  })
})
