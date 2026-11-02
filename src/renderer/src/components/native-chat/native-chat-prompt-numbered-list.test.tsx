// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NativeChatComposerInput } from './native-chat-composer-input'
import { NativeChatPromptEditor } from './NativeChatPromptEditor'
import { promptEditor } from './native-chat-prompt-editor.test-support'

afterEach(cleanup)

function setup(value: string, caret = value.length) {
  const inputRef = createRef<NativeChatComposerInput>()
  const view = render(
    <NativeChatPromptEditor
      inputRef={inputRef}
      initialValue={value}
      disabled={false}
      placeholder="Message"
      onChange={vi.fn()}
      onSelect={vi.fn()}
    />
  )
  const input = inputRef.current!
  const textbox = within(view.container).getByRole('textbox')
  act(() => input.setSelectionRange(caret, caret))
  return {
    input,
    editor: promptEditor(textbox),
    press: (init: KeyboardEventInit = {}) =>
      fireEvent.keyDown(textbox, { key: 'Enter', keyCode: 13, ...init })
  }
}

describe('numbered list continuation', () => {
  it('starts the next line with the next number and the caret after it', () => {
    const { input, press } = setup('1. first')
    press()
    expect(input.value).toBe('1. first\n2. ')
    expect(input.selectionStart).toBe(input.value.length)
  })

  it('keeps the indent, the spacing and the zero padding', () => {
    const { input, press } = setup('  09.  ninth')
    press()
    expect(input.value).toBe('  09.  ninth\n  10.  ')
  })

  it('moves the text after the caret into the next item', () => {
    const { input, press } = setup('1. foobar', '1. foo'.length)
    press()
    expect(input.value).toBe('1. foo\n2. bar')
    expect(input.selectionStart).toBe('1. foo\n2. '.length)
  })

  it('ends the list on an empty item with a blank line, which keeps later text out of the list', () => {
    const { input, press } = setup('1. first\n2. ')
    press()
    expect(input.value).toBe('1. first\n\n')
    expect(input.selectionStart).toBe(input.value.length)
  })

  it.each([
    ['alone', '1. ', ''],
    ['after other text', 'intro\n1. ', 'intro\n']
  ])('only clears an empty item that follows no list: %s', (_case, value, expected) => {
    const { input, press } = setup(value)
    press()
    expect(input.value).toBe(expected)
    expect(input.selectionStart).toBe(input.value.length)
  })

  it('continues from a line that follows Shift+Enter, which itself adds a plain line', () => {
    const { input, press } = setup('1. first')
    press({ shiftKey: true })
    expect(input.value).toBe('1. first\n')
    act(() => input.insertText?.('2. second'))
    press()
    expect(input.value).toBe('1. first\n2. second\n3. ')
  })

  it('undoes the new line and its number together', () => {
    const { input, editor, press } = setup('1. first')
    press()
    act(() => {
      editor.commands.undo()
    })
    expect(input.value).toBe('1. first')
  })

  it.each([
    ['text without a number', 'hello', 5, 'hello\n'],
    ['no space after the dot', '1.first', 7, '1.first\n'],
    ['a number later in the line', 'see 1. first', 12, 'see 1. first\n'],
    ['a caret inside the number', '1. first', 1, '1\n. first']
  ])('leaves Enter as a plain new line for %s', (_case, value, caret, expected) => {
    const { input, press } = setup(value, caret)
    press()
    expect(input.value).toBe(expected)
  })

  it('leaves Enter as a plain new line while text is selected', () => {
    const { input, press } = setup('1. first')
    act(() => input.setSelectionRange(3, 8))
    press()
    expect(input.value).toBe('1. \n')
  })
})
