import { useCallback } from 'react'
import {
  BOTTOM_PANEL_SIZE_LIMITS,
  useBottomPanelLayout,
  type BottomPanelSizeKey
} from './bottom-panel-layout-store'
import { useDragResize, type DragResizeAxis, type DragResizeHandleProps } from './use-drag-resize'

/** Drag-resize one of the bottom panel's persisted regions. */
export function useBottomPanelRegionResize(
  key: BottomPanelSizeKey,
  axis: DragResizeAxis,
  direction: 1 | -1,
  getMax: () => number
): { size: number; handleProps: DragResizeHandleProps } {
  const size = useBottomPanelLayout((s) => s[key])
  const setStoredSize = useBottomPanelLayout((s) => s.setSize)
  const previewStoredSize = useBottomPanelLayout((s) => s.previewSize)
  const setSize = useCallback((next: number) => setStoredSize(key, next), [key, setStoredSize])
  const onPreview = useCallback(
    (next: number) => previewStoredSize(key, next),
    [key, previewStoredSize]
  )
  return useDragResize({
    axis,
    size,
    setSize,
    onPreview,
    min: BOTTOM_PANEL_SIZE_LIMITS[key].min,
    getMax,
    direction
  })
}
