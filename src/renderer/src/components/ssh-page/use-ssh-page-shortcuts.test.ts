import { describe, expect, it, vi } from 'vitest'
import { layoutFromKeyEvent } from './use-ssh-page-shortcuts'

vi.mock('@/store', () => ({ useAppStore: { getState: () => ({}) } }))

function keyEvent(
  code: string,
  modifiers: {
    meta?: boolean
    ctrl?: boolean
    alt?: boolean
    shift?: boolean
    altGraph?: boolean
  }
): Parameters<typeof layoutFromKeyEvent>[0] {
  return {
    code,
    metaKey: modifiers.meta === true,
    ctrlKey: modifiers.ctrl === true,
    altKey: modifiers.alt === true,
    shiftKey: modifiers.shift === true,
    getModifierState: (key) => key === 'AltGraph' && modifiers.altGraph === true
  }
}

describe('layoutFromKeyEvent', () => {
  it('maps ⌘⌥1/2/3 on macOS to the three layouts', () => {
    const chord = { meta: true, alt: true }

    expect(layoutFromKeyEvent(keyEvent('Digit1', chord), 'darwin')).toBe('terminal')
    expect(layoutFromKeyEvent(keyEvent('Digit2', chord), 'darwin')).toBe('split')
    expect(layoutFromKeyEvent(keyEvent('Digit3', chord), 'darwin')).toBe('files')
  })

  it('maps Ctrl+Alt+1/2/3 elsewhere', () => {
    const chord = { ctrl: true, alt: true }

    expect(layoutFromKeyEvent(keyEvent('Digit2', chord), 'win32')).toBe('split')
    expect(layoutFromKeyEvent(keyEvent('Digit3', chord), 'linux')).toBe('files')
  })

  it('leaves AltGr alone, because it types characters into the terminal', () => {
    const altGr = { ctrl: true, alt: true, altGraph: true }

    expect(layoutFromKeyEvent(keyEvent('Digit2', altGr), 'win32')).toBeNull()
    expect(layoutFromKeyEvent(keyEvent('Digit2', altGr), 'linux')).toBeNull()
  })

  it('ignores other modifier sets and other keys', () => {
    expect(layoutFromKeyEvent(keyEvent('Digit1', { alt: true }), 'darwin')).toBeNull()
    expect(layoutFromKeyEvent(keyEvent('Digit1', { ctrl: true, alt: true }), 'darwin')).toBeNull()
    expect(layoutFromKeyEvent(keyEvent('Digit1', { meta: true, alt: true }), 'win32')).toBeNull()
    expect(
      layoutFromKeyEvent(keyEvent('Digit1', { meta: true, alt: true, shift: true }), 'darwin')
    ).toBeNull()
    expect(layoutFromKeyEvent(keyEvent('Digit4', { meta: true, alt: true }), 'darwin')).toBeNull()
  })
})
