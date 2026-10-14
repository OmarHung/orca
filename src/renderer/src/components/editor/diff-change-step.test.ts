import { describe, expect, it, vi } from 'vitest'
import {
  didDiffChangeStepWrap,
  stepDiffChange,
  type DiffChangeCursorEditor
} from './diff-change-step'

function createCursorEditor(startLine: number): {
  modified: DiffChangeCursorEditor
  state: { line: number; scrollTop: number }
} {
  const state = { line: startLine, scrollTop: 240 }
  const modified: DiffChangeCursorEditor = {
    getPosition: () => ({ lineNumber: state.line, column: 1 }),
    setPosition: (position) => {
      state.line = position.lineNumber
    },
    getScrollTop: () => state.scrollTop,
    setScrollTop: (scrollTop) => {
      state.scrollTop = scrollTop
    }
  }
  return { modified, state }
}

describe('didDiffChangeStepWrap', () => {
  it.each([
    { direction: 'next', from: 20, to: 10, expected: true },
    { direction: 'next', from: 20, to: 20, expected: true },
    { direction: 'next', from: 10, to: 20, expected: false },
    { direction: 'previous', from: 10, to: 20, expected: true },
    { direction: 'previous', from: 20, to: 10, expected: false }
  ] as const)('$direction from line $from to $to wraps=$expected', (testCase) => {
    // Arrange / Act
    const wrapped = didDiffChangeStepWrap(testCase.direction, testCase.from, testCase.to)

    // Assert
    expect(wrapped).toBe(testCase.expected)
  })
})

describe('stepDiffChange', () => {
  it('delegates to goToDiff when the target exposes no cursor', () => {
    // Arrange
    const goToDiff = vi.fn()

    // Act
    const result = stepDiffChange({ goToDiff }, 'next')

    // Assert
    expect(goToDiff).toHaveBeenCalledWith('next')
    expect(result).toBe('moved')
  })

  it('keeps the new position when the step stays inside the file', () => {
    // Arrange
    const { modified, state } = createCursorEditor(1)
    const goToDiff = vi.fn(() => {
      state.line = 10
    })

    // Act
    const result = stepDiffChange({ goToDiff, getModifiedEditor: () => modified }, 'next')

    // Assert
    expect(result).toBe('moved')
    expect(state.line).toBe(10)
  })

  it('restores cursor and scroll when goToDiff wraps to the first change', () => {
    // Arrange
    const { modified, state } = createCursorEditor(20)
    const goToDiff = vi.fn(() => {
      state.line = 10
      state.scrollTop = 0
    })

    // Act
    const result = stepDiffChange({ goToDiff, getModifiedEditor: () => modified }, 'next')

    // Assert
    expect(result).toBe('wrapped')
    expect(state.line).toBe(20)
    expect(state.scrollTop).toBe(240)
  })

  it('restores cursor and scroll when previous wraps to the last change', () => {
    // Arrange
    const { modified, state } = createCursorEditor(10)
    const goToDiff = vi.fn(() => {
      state.line = 20
      state.scrollTop = 0
    })

    // Act
    const result = stepDiffChange({ goToDiff, getModifiedEditor: () => modified }, 'previous')

    // Assert
    expect(result).toBe('wrapped')
    expect(state.line).toBe(10)
    expect(state.scrollTop).toBe(240)
  })
})
