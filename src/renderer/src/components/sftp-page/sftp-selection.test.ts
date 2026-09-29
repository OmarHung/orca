import { describe, expect, it } from 'vitest'
import {
  applySelectionClick,
  EMPTY_SELECTION,
  pruneSelection,
  selectionModifiersFromEvent
} from './sftp-selection'

const paths = ['/a', '/b', '/c', '/d']
const plain = { toggle: false, range: false }

function selected(selection: { selected: ReadonlySet<string> }): string[] {
  return [...selection.selected].sort()
}

describe('pane selection', () => {
  it('selects only the clicked entry on a plain click', () => {
    const first = applySelectionClick(EMPTY_SELECTION, paths, '/b', plain)
    expect(selected(applySelectionClick(first, paths, '/d', plain))).toEqual(['/d'])
  })

  it('adds and removes entries with the toggle modifier', () => {
    const one = applySelectionClick(EMPTY_SELECTION, paths, '/a', plain)
    const two = applySelectionClick(one, paths, '/c', { toggle: true, range: false })
    expect(selected(two)).toEqual(['/a', '/c'])
    expect(selected(applySelectionClick(two, paths, '/a', { toggle: true, range: false }))).toEqual(
      ['/c']
    )
  })

  it('extends a range from the anchor in either direction', () => {
    const anchored = applySelectionClick(EMPTY_SELECTION, paths, '/c', plain)
    expect(
      selected(applySelectionClick(anchored, paths, '/a', { toggle: false, range: true }))
    ).toEqual(['/a', '/b', '/c'])
  })

  it('uses Cmd on macOS and Ctrl elsewhere to toggle', () => {
    const event = { metaKey: true, ctrlKey: false, shiftKey: false }
    expect(selectionModifiersFromEvent(event, true).toggle).toBe(true)
    expect(selectionModifiersFromEvent(event, false).toggle).toBe(false)
  })

  it('forgets entries that vanished after a refresh', () => {
    const both = applySelectionClick(
      applySelectionClick(EMPTY_SELECTION, paths, '/a', plain),
      paths,
      '/b',
      { toggle: true, range: false }
    )
    const pruned = pruneSelection(both, ['/a', '/c'])
    expect(selected(pruned)).toEqual(['/a'])
    expect(pruned.anchor).toBeNull()
  })
})
