import { describe, expect, it } from 'vitest'
import { isToggleSelectionClick, nextGitLogSelection } from './use-git-log-selection'

const NONE = { primary: null, secondary: null }

describe('nextGitLogSelection', () => {
  it('replaces the selection on a plain click', () => {
    expect(nextGitLogSelection({ primary: 'a', secondary: 'b' }, 'c', false)).toEqual({
      primary: 'c',
      secondary: null
    })
  })

  it('adds a second commit on a toggle click and drops the oldest after that', () => {
    const one = nextGitLogSelection(NONE, 'a', false)
    const two = nextGitLogSelection(one, 'b', true)
    expect(two).toEqual({ primary: 'b', secondary: 'a' })
    expect(nextGitLogSelection(two, 'c', true)).toEqual({ primary: 'c', secondary: 'b' })
  })

  it('removes a selected commit on a toggle click', () => {
    const two = { primary: 'b', secondary: 'a' }
    expect(nextGitLogSelection(two, 'b', true)).toEqual({ primary: 'a', secondary: null })
    expect(nextGitLogSelection(two, 'a', true)).toEqual({ primary: 'b', secondary: null })
  })
})

describe('isToggleSelectionClick', () => {
  it('uses ⌘ on macOS and Ctrl elsewhere', () => {
    expect(isToggleSelectionClick({ metaKey: true, ctrlKey: false }, true)).toBe(true)
    expect(isToggleSelectionClick({ metaKey: false, ctrlKey: true }, true)).toBe(false)
    expect(isToggleSelectionClick({ metaKey: false, ctrlKey: true }, false)).toBe(true)
    expect(isToggleSelectionClick({ metaKey: true, ctrlKey: false }, false)).toBe(false)
  })
})
