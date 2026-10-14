// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DiffNavigationProvider,
  useDiffEditorRegistration,
  useDiffNavigation,
  type DiffEditorRegistrationContextValue,
  type DiffNavigationContextValue
} from './diff-navigation-context'

vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

const FILE_END_NOTICE = 'Last change in this file. Press again to open the next file.'
const FILE_START_NOTICE = 'First change in this file. Press again to open the previous file.'
const LAST_FILE_NOTICE = 'This is the last changed file.'
const FIRST_FILE_NOTICE = 'This is the first changed file.'

// Why: mirrors Monaco's goToDiff, including the silent wrap to the first or last change.
function createMonacoLikeEditor(changeStarts: readonly number[], startLine: number) {
  const state = { line: startLine, scrollTop: 240 }
  const first = changeStarts.at(0) ?? 0
  const last = changeStarts.at(-1) ?? 0
  const goToDiff = vi.fn((direction: 'next' | 'previous') => {
    state.scrollTop = 0
    if (direction === 'next') {
      state.line = changeStarts.find((line) => line > state.line) ?? first
      return
    }
    const before = changeStarts.filter((line) => line < state.line)
    state.line = before.at(-1) ?? last
  })
  const containerNode = document.createElement('div')
  const editor = {
    getContainerDomNode: () => containerNode,
    goToDiff,
    getLineChanges: () => changeStarts.map((line) => ({ line })),
    onDidUpdateDiff: () => ({ dispose: () => {} }),
    getModifiedEditor: () => ({
      getPosition: () => ({ lineNumber: state.line, column: 1 }),
      setPosition: (position: { lineNumber: number; column: number }) => {
        state.line = position.lineNumber
      },
      getScrollTop: () => state.scrollTop,
      setScrollTop: (scrollTop: number) => {
        state.scrollTop = scrollTop
      }
    })
  }
  return { editor, state, goToDiff }
}

let captured: DiffNavigationContextValue | null = null
let registration: DiffEditorRegistrationContextValue | null = null

function Probe(): null {
  captured = useDiffNavigation()
  return null
}

function RegistrationProbe(): null {
  registration = useDiffEditorRegistration()
  return null
}

describe('DiffNavigationProvider file boundary', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null
  const toastMock = vi.mocked(toast)

  // Why: mirrors the panel, which resolves a neighbouring file's opener or null when there is none.
  function createOpener(hasNeighbour: boolean) {
    const open = vi.fn()
    const resolve = vi.fn((_direction: 'next' | 'previous') => (hasNeighbour ? open : null))
    return { open, resolve }
  }

  function mount(resolve: (direction: 'next' | 'previous') => (() => void) | null): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        <DiffNavigationProvider resolveAdjacentFileOpener={resolve}>
          <Probe />
          <RegistrationProbe />
        </DiffNavigationProvider>
      )
    })
  }

  beforeEach(() => {
    toastMock.mockClear()
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
    }
    container?.remove()
    container = null
    root = null
    captured = null
    registration = null
  })

  it('shows the end notice on the first press at the last change and keeps the cursor', () => {
    // Arrange
    const { open, resolve } = createOpener(true)
    mount(resolve)
    const { editor, state } = createMonacoLikeEditor([10, 20], 20)
    act(() => registration?.registerDiffEditor(editor))

    // Act
    act(() => captured?.goToNextDiff())

    // Assert
    expect(toastMock).toHaveBeenCalledWith(FILE_END_NOTICE)
    expect(state.line).toBe(20)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the next file on the second press at the boundary', () => {
    // Arrange
    const { open, resolve } = createOpener(true)
    mount(resolve)
    const { editor } = createMonacoLikeEditor([10, 20], 20)
    act(() => registration?.registerDiffEditor(editor))
    act(() => captured?.goToNextDiff())

    // Act
    act(() => captured?.goToNextDiff())

    // Assert
    expect(open).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it('shows the start notice and opens the previous file when stepping back from the first change', () => {
    // Arrange
    const { open, resolve } = createOpener(true)
    mount(resolve)
    const { editor, state } = createMonacoLikeEditor([10, 20], 10)
    act(() => registration?.registerDiffEditor(editor))

    // Act
    act(() => captured?.goToPreviousDiff())
    act(() => captured?.goToPreviousDiff())

    // Assert
    expect(toastMock).toHaveBeenCalledWith(FILE_START_NOTICE)
    expect(resolve).toHaveBeenLastCalledWith('previous')
    expect(open).toHaveBeenCalledTimes(1)
    expect(state.line).toBe(10)
  })

  it('does not notice or open a file for a step inside the file', () => {
    // Arrange
    const { open, resolve } = createOpener(true)
    mount(resolve)
    const { editor, state } = createMonacoLikeEditor([10, 20], 1)
    act(() => registration?.registerDiffEditor(editor))

    // Act
    act(() => captured?.goToNextDiff())

    // Assert
    expect(state.line).toBe(10)
    expect(toastMock).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('disarms the boundary after an in-file move so the next boundary notices again', () => {
    // Arrange
    const { open, resolve } = createOpener(true)
    mount(resolve)
    const { editor } = createMonacoLikeEditor([10, 20], 20)
    act(() => registration?.registerDiffEditor(editor))
    act(() => captured?.goToNextDiff())

    // Act
    act(() => captured?.goToPreviousDiff())
    act(() => captured?.goToNextDiff())
    act(() => captured?.goToNextDiff())

    // Assert
    expect(toastMock).toHaveBeenCalledTimes(2)
    expect(open).not.toHaveBeenCalled()
  })

  it('reports the last file at once instead of asking to press again', () => {
    // Arrange
    const { open, resolve } = createOpener(false)
    mount(resolve)
    const { editor } = createMonacoLikeEditor([10, 20], 20)
    act(() => registration?.registerDiffEditor(editor))

    // Act
    act(() => captured?.goToNextDiff())

    // Assert
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(LAST_FILE_NOTICE)
    expect(open).not.toHaveBeenCalled()
  })

  it('reports the first file at once when stepping back with no earlier file', () => {
    // Arrange
    const { resolve } = createOpener(false)
    mount(resolve)
    const { editor } = createMonacoLikeEditor([10, 20], 10)
    act(() => registration?.registerDiffEditor(editor))

    // Act
    act(() => captured?.goToPreviousDiff())

    // Assert
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock).toHaveBeenCalledWith(FIRST_FILE_NOTICE)
  })
})
