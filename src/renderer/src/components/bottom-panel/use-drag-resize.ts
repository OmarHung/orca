import type React from 'react'
import { useEffect, useRef, useState } from 'react'

const KEYBOARD_STEP_PX = 16

export type DragResizeAxis = 'x' | 'y'

type DragResizeOptions = {
  axis: DragResizeAxis
  /** Persisted size; only written when a drag or key press ends. */
  size: number
  setSize: (size: number) => void
  /** Called on every move so readers outside this hook (e.g. sibling table rows) track the drag. */
  onPreview?: (size: number) => void
  min: number
  /** Read at drag start, so the bound tracks the container's current size. */
  getMax: () => number
  /** +1 when dragging right/down grows the region, -1 when dragging left/up does. */
  direction: 1 | -1
}

type Session = {
  start: number
  startSize: number
  max: number
  previousCursor: string
  previousUserSelect: string
}

export type DragResizeHandleProps = {
  role: 'separator'
  tabIndex: 0
  'aria-orientation': 'horizontal' | 'vertical'
  'aria-valuenow': number
  'aria-valuemin': number
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

export function clampDragSize(size: number, min: number, max: number): number {
  return Math.min(Math.max(min, max), Math.max(min, size))
}

/** Pointer + keyboard resizing for a split region. Live size stays local until release. */
export function useDragResize({
  axis,
  size,
  setSize,
  onPreview,
  min,
  getMax,
  direction
}: DragResizeOptions): {
  size: number
  handleProps: DragResizeHandleProps
} {
  const [dragSize, setDragSize] = useState<number | null>(null)
  const dragSizeRef = useRef<number | null>(null)
  const sessionRef = useRef<Session | null>(null)

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const session = sessionRef.current
      if (!session) {
        return
      }
      const position = axis === 'x' ? event.clientX : event.clientY
      const next = clampDragSize(
        session.startSize + direction * (position - session.start),
        min,
        session.max
      )
      dragSizeRef.current = next
      setDragSize(next)
      onPreview?.(next)
    }
    const onEnd = (): void => {
      const session = sessionRef.current
      if (!session) {
        return
      }
      sessionRef.current = null
      document.body.style.cursor = session.previousCursor
      document.body.style.userSelect = session.previousUserSelect
      if (dragSizeRef.current !== null) {
        setSize(dragSizeRef.current)
      }
      dragSizeRef.current = null
      setDragSize(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    window.addEventListener('blur', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      window.removeEventListener('blur', onEnd)
    }
  }, [axis, direction, min, onPreview, setSize])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault()
    const max = getMax()
    sessionRef.current = {
      start: axis === 'x' ? event.clientX : event.clientY,
      startSize: clampDragSize(size, min, max),
      max,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect
    }
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    const [decreaseKey, increaseKey] =
      axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    if (event.key !== decreaseKey && event.key !== increaseKey) {
      return
    }
    event.preventDefault()
    const step = KEYBOARD_STEP_PX * (event.shiftKey ? 2 : 1)
    const sign = event.key === increaseKey ? direction : -direction
    setSize(clampDragSize(size + sign * step, min, getMax()))
  }

  return {
    size: dragSize ?? size,
    handleProps: {
      role: 'separator',
      tabIndex: 0,
      // Why: a separator between side-by-side regions is a vertical line.
      'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
      'aria-valuenow': Math.round(dragSize ?? size),
      'aria-valuemin': min,
      onPointerDown,
      onKeyDown
    }
  }
}
