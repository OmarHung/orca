import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { editor } from 'monaco-editor'
import { Glasses } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { refreshWatches } from './debug-evaluate'
import { useDebugStore } from './debug-store'
import { DebugValueHover, type DebugHoverValue } from './debug-value-hover'
import { MAX_POPUP_HEIGHT_PX, placeValuePopup } from './debug-value-hover-placement'
import { VariableRow } from './DebugVariablesTree'
import { DEBUGGABLE_LANGUAGES } from './use-monaco-debug-decorations'
import { useWatchStore } from './watch-store'

function AddToWatchesButton({ expression }: { expression: string }): React.JSX.Element {
  const label = translate('debug.hover.addToWatches', 'Add to Watches')
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={() => {
        useWatchStore.getState().add(expression)
        void refreshWatches()
      }}
    >
      <Glasses />
    </Button>
  )
}

function DebugValuePopup({
  value,
  onPointerInside
}: {
  value: DebugHoverValue
  onPointerInside: (inside: boolean) => void
}): React.JSX.Element {
  const popupRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const popup = popupRef.current
    const content = contentRef.current
    if (!popup || !content) {
      return
    }
    // Positioned imperatively so growing (expanding a value) re-places it without a re-render.
    const place = (): void => {
      const borders = popup.offsetHeight - popup.clientHeight
      const placement = placeValuePopup(
        value.anchor,
        { width: popup.offsetWidth, height: content.offsetHeight + borders },
        { width: window.innerWidth, height: window.innerHeight }
      )
      popup.style.left = `${placement.left}px`
      popup.style.top = `${placement.top}px`
      popup.style.maxHeight = `${placement.maxHeight}px`
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(content)
    return () => observer.disconnect()
  }, [value.anchor])

  return (
    <div
      ref={popupRef}
      data-testid="debug-value-hover"
      // Why fixed on body: inside the editor, panels below it clipped an expanded value.
      className="scrollbar-sleek fixed z-50 w-max max-w-[min(40rem,80vw)] min-w-48 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-floating"
      style={{
        left: value.anchor.left,
        top: value.anchor.bottom,
        maxHeight: MAX_POPUP_HEIGHT_PX
      }}
      onPointerEnter={() => onPointerInside(true)}
      onPointerLeave={() => onPointerInside(false)}
      // Keeps focus (and Escape, typing) in the editor while rows expand, as JetBrains does.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div ref={contentRef} className="py-0.5">
        <VariableRow
          // A new key per target so expansion state never leaks between names.
          key={`${value.lineNumber}:${value.startColumn}:${value.expression}`}
          depth={0}
          variable={{
            name: value.expression,
            value: value.result.value,
            type: value.result.type,
            variablesReference: value.result.variablesReference
          }}
          trailing={<AddToWatchesButton expression={value.expression} />}
        />
      </div>
    </div>
  )
}

/** Shows a hovered name's value in the editor while the selected frame is paused in this file. */
export function DebugValueHoverWidget({
  editor: codeEditor,
  filePath,
  language
}: {
  editor: editor.IStandaloneCodeEditor | null
  filePath: string
  language: string
}): React.JSX.Element | null {
  const pausedFrameId = useDebugStore((s) =>
    s.session?.stoppedThreadId != null && s.executionLocation?.path === filePath
      ? s.selectedFrameId
      : null
  )
  const [value, setValue] = useState<DebugHoverValue | null>(null)
  const controllerRef = useRef<DebugValueHover | null>(null)

  useEffect(() => {
    if (!codeEditor || pausedFrameId === null || !DEBUGGABLE_LANGUAGES.has(language)) {
      return
    }
    // A fresh controller per paused frame, so values never outlive the frame they came from.
    const controller = new DebugValueHover(codeEditor, setValue)
    controllerRef.current = controller
    return () => {
      controllerRef.current = null
      controller.dispose()
    }
  }, [codeEditor, language, pausedFrameId])

  if (!value) {
    return null
  }
  return createPortal(
    <DebugValuePopup
      value={value}
      onPointerInside={(inside) => controllerRef.current?.setPointerInPopup(inside)}
    />,
    document.body
  )
}
