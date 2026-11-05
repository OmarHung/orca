import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

type RowWidthListener = (key: string, width: number) => void

/**
 * The widest row's full width, so a virtualized tree scrolls sideways instead of cutting names short.
 * Rows report as they render; widths stay remembered by key, so scrolling never shortens the scrollbar.
 */
export function useWidestRow(keys: readonly string[]): {
  widest: number
  onMeasure: RowWidthListener
} {
  // Why a ref: file trees reach tens of thousands of rows; copying a Map per report would stall scrolling.
  const widthsRef = useRef(new Map<string, number>())
  const keysRef = useRef(keys)
  const [widest, setWidest] = useState(0)

  const recompute = useCallback(() => {
    const widths = widthsRef.current
    setWidest(keysRef.current.reduce((max, key) => Math.max(max, widths.get(key) ?? 0), 0))
  }, [])

  useLayoutEffect(() => {
    keysRef.current = keys
    recompute()
  }, [keys, recompute])

  const onMeasure = useCallback<RowWidthListener>(
    (key, width) => {
      const previous = widthsRef.current.get(key)
      if (previous === width) {
        return
      }
      widthsRef.current.set(key, width)
      // Only a shrink can unseat the widest row, so only a shrink pays for a full scan.
      if (previous !== undefined && width < previous) {
        recompute()
        return
      }
      setWidest((current) => Math.max(current, width))
    },
    [recompute]
  )

  return { widest, onMeasure }
}

/** Reports `key`'s width from the attached label, which must sit inside the row's positioned box. */
export function useRowWidthReporter<T extends HTMLElement>(
  key: string,
  onMeasure: RowWidthListener | undefined,
  endPadding: number,
  /** Re-measures when the label moves without resizing, which ResizeObserver cannot see. */
  labelStart?: number
): RefObject<T | null> {
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const label = ref.current
    if (!label || !onMeasure) {
      return
    }
    // Why offsetLeft: it counts from the row's own box, indent included.
    const report = (): void => onMeasure(key, label.offsetLeft + label.offsetWidth + endPadding)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(label)
    return () => observer.disconnect()
  }, [key, onMeasure, endPadding, labelStart])
  return ref
}
