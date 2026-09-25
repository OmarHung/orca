import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SYNC_FIT_PANES_EVENT } from '@/constants/terminal'
import { translate } from '@/i18n/i18n'
import {
  BOTTOM_PANEL_MIN_HEIGHT,
  BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT,
  useBottomPanelLayout
} from './bottom-panel-layout-store'

const GitLogView = lazy(() =>
  import('./git-log/GitLogView').then((module) => ({
    default: module.GitLogView
  }))
)

const KEYBOARD_RESIZE_STEP = 16

type ResizeSession = {
  startY: number
  startHeight: number
  maxHeight: number
  previousCursor: string
  previousUserSelect: string
}

function useBottomPanelResize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const storedHeight = useBottomPanelLayout((s) => s.height)
  const setStoredHeight = useBottomPanelLayout((s) => s.setHeight)
  // Why local drag height: persisting on every pointermove would hammer localStorage.
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const dragHeightRef = useRef<number | null>(null)
  const sessionRef = useRef<ResizeSession | null>(null)

  const maxHeightNow = useCallback((): number => {
    const parentHeight = containerRef.current?.parentElement?.clientHeight ?? 0
    return Math.max(BOTTOM_PANEL_MIN_HEIGHT, parentHeight - BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT)
  }, [containerRef])

  const clampToParent = useCallback(
    (height: number, maxHeight: number): number =>
      Math.min(maxHeight, Math.max(BOTTOM_PANEL_MIN_HEIGHT, height)),
    []
  )

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const session = sessionRef.current
      if (session) {
        const next = clampToParent(
          session.startHeight + session.startY - event.clientY,
          session.maxHeight
        )
        dragHeightRef.current = next
        setDragHeight(next)
      }
    }
    const onEnd = (): void => {
      const session = sessionRef.current
      if (!session) {
        return
      }
      sessionRef.current = null
      document.body.style.cursor = session.previousCursor
      document.body.style.userSelect = session.previousUserSelect
      if (dragHeightRef.current !== null) {
        setStoredHeight(dragHeightRef.current)
      }
      dragHeightRef.current = null
      setDragHeight(null)
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
  }, [clampToParent, setStoredHeight])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const maxHeight = maxHeightNow()
    sessionRef.current = {
      startY: event.clientY,
      startHeight: clampToParent(storedHeight, maxHeight),
      maxHeight,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect
    }
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? KEYBOARD_RESIZE_STEP * 2 : KEYBOARD_RESIZE_STEP
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const delta = event.key === 'ArrowUp' ? step : -step
      setStoredHeight(clampToParent(storedHeight + delta, maxHeightNow()))
    }
  }

  return { height: dragHeight ?? storedHeight, onPointerDown, onKeyDown }
}

export function BottomPanel(): React.JSX.Element {
  const setOpen = useBottomPanelLayout((s) => s.setOpen)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { height, onPointerDown, onKeyDown } = useBottomPanelResize(containerRef)

  // Why: refit terminals in the same frame the workbench height changes, like sidebar toggles.
  useLayoutEffect(() => {
    window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
  }, [height])
  useLayoutEffect(
    () => () => {
      window.dispatchEvent(new CustomEvent(SYNC_FIT_PANES_EVENT))
    },
    []
  )

  return (
    <div
      ref={containerRef}
      data-testid="bottom-panel"
      className="relative flex shrink-0 flex-col border-t border-border bg-background"
      // Why max-height: a height stored on a taller window must not push the workbench off-screen.
      style={{
        height,
        maxHeight: `calc(100% - ${BOTTOM_PANEL_MIN_WORKBENCH_HEIGHT}px)`,
        minHeight: BOTTOM_PANEL_MIN_HEIGHT
      }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={translate('bottomPanel.resize', 'Resize bottom panel')}
        aria-valuenow={Math.round(height)}
        tabIndex={0}
        className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none focus-visible:bg-ring/30"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="text-xs font-semibold text-foreground">
          {translate('bottomPanel.gitTitle', 'Git')}
        </span>
        <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-accent-foreground">
          {translate('bottomPanel.logTab', 'Log')}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate('bottomPanel.hide', 'Hide bottom panel')}
          title={translate('bottomPanel.hide', 'Hide bottom panel')}
          onClick={() => setOpen(false)}
        >
          <Minus />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <GitLogView />
        </Suspense>
      </div>
    </div>
  )
}
