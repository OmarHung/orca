import { describe, expect, it } from 'vitest'
import { createNavigationHistory, type NavigationLocation } from './code-navigation-history'

function at(filePath: string, line: number, worktreeId = 'wt-1'): NavigationLocation {
  return { worktreeId, runtimeEnvironmentId: null, filePath, line, column: 1 }
}

describe('createNavigationHistory', () => {
  it('goes back to where a jump started and forward again', () => {
    const history = createNavigationHistory()
    history.noteLocation(at('/app.ts', 3))
    history.recordJump(at('/app.ts', 3))
    history.noteLocation(at('/greeter.ts', 1))

    expect(history.step('back', at('/greeter.ts', 1))).toEqual(at('/app.ts', 3))
    history.noteLocation(at('/app.ts', 3))
    expect(history.step('forward', at('/app.ts', 3))).toEqual(at('/greeter.ts', 1))
    history.noteLocation(at('/greeter.ts', 1))
    expect(history.step('forward', at('/greeter.ts', 1))).toBeNull()
  })

  it('records switching to another file as a move, not the arrival of a step', () => {
    const history = createNavigationHistory()
    history.noteLocation(at('/a.ts', 10))
    history.noteLocation(at('/b.ts', 2))
    history.noteLocation(at('/c.ts', 5))

    expect(history.step('back', at('/c.ts', 5))).toEqual(at('/b.ts', 2))
    // The tab the step opened reports itself; that must not push another entry.
    history.noteLocation(at('/b.ts', 2))
    expect(history.step('back', at('/b.ts', 2))).toEqual(at('/a.ts', 10))
  })

  it('drops the forward history when a new jump starts', () => {
    const history = createNavigationHistory()
    history.recordJump(at('/a.ts', 1))
    history.noteLocation(at('/b.ts', 1))
    history.step('back', at('/b.ts', 1))
    history.noteLocation(at('/a.ts', 1))

    history.recordJump(at('/a.ts', 1))
    history.noteLocation(at('/c.ts', 1))

    expect(history.step('forward', at('/c.ts', 1))).toBeNull()
  })

  it('keeps in-file jumps and skips entries for the spot the cursor is on', () => {
    const history = createNavigationHistory()
    history.recordJump(at('/a.ts', 40))
    history.recordJump(at('/a.ts', 40))

    expect(history.step('back', at('/a.ts', 40))).toBeNull()
    history.recordJump(at('/a.ts', 5))
    expect(history.step('back', at('/a.ts', 80))).toEqual(at('/a.ts', 5))
  })

  it('keeps each workspace separate', () => {
    const history = createNavigationHistory()
    history.recordJump(at('/a.ts', 1, 'wt-1'))
    history.recordJump(at('/x.ts', 1, 'wt-2'))

    expect(history.step('back', at('/b.ts', 1, 'wt-1'))).toEqual(at('/a.ts', 1, 'wt-1'))
    expect(history.step('back', at('/y.ts', 1, 'wt-2'))).toEqual(at('/x.ts', 1, 'wt-2'))
  })

  it('keeps at most fifty entries', () => {
    const history = createNavigationHistory()
    for (let line = 1; line <= 60; line += 1) {
      history.recordJump(at('/a.ts', line))
    }
    let steps = 0
    let here = at('/a.ts', 100)
    for (let target = history.step('back', here); target; target = history.step('back', here)) {
      steps += 1
      here = target
    }
    expect(steps).toBe(50)
  })
})
