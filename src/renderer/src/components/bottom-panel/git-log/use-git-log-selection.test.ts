import { describe, expect, it } from 'vitest'
import {
  isToggleSelectionClick,
  nextGitLogSelection,
  type GitLogSelection
} from './use-git-log-selection'

const LOG = ['e', 'd', 'c', 'b', 'a']
const NONE: GitLogSelection = { ids: [], primary: null, anchor: null }
const CLICK = { toggle: false, range: false }
const TOGGLE = { toggle: true, range: false }
const RANGE = { toggle: false, range: true }

function clicks(...steps: [string, typeof CLICK][]): GitLogSelection {
  return steps.reduce(
    (selection, [id, modifiers]) => nextGitLogSelection(selection, id, modifiers, LOG),
    NONE
  )
}

describe('nextGitLogSelection', () => {
  it('replaces the selection on a plain click', () => {
    expect(clicks(['d', CLICK], ['b', CLICK])).toEqual({ ids: ['b'], primary: 'b', anchor: 'b' })
  })

  it('adds and removes commits with ⌘/Ctrl, without a limit', () => {
    expect(clicks(['e', CLICK], ['c', TOGGLE], ['a', TOGGLE]).ids).toEqual(['e', 'c', 'a'])
    expect(clicks(['e', CLICK], ['c', TOGGLE], ['e', TOGGLE])).toEqual({
      ids: ['c'],
      primary: 'c',
      anchor: 'c'
    })
  })

  it('selects a contiguous range with Shift from the last plain or ⌘ click', () => {
    expect(clicks(['d', CLICK], ['a', RANGE]).ids).toEqual(['d', 'c', 'b', 'a'])
    expect(clicks(['b', CLICK], ['e', RANGE]).ids).toEqual(['e', 'd', 'c', 'b'])
    expect(clicks(['e', CLICK], ['c', TOGGLE], ['a', RANGE]).ids).toEqual(['c', 'b', 'a'])
  })

  it('adds a range to the selection with ⌘/Ctrl+Shift', () => {
    expect(clicks(['e', CLICK], ['c', TOGGLE], ['a', { toggle: true, range: true }]).ids).toEqual([
      'e',
      'c',
      'b',
      'a'
    ])
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
