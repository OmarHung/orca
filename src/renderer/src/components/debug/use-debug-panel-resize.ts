import { useRef } from 'react'
import {
  DEBUG_MIN_VARIABLES_HEIGHT,
  DEBUG_MIN_VARIABLES_WIDTH,
  useBottomPanelLayout
} from '../bottom-panel/bottom-panel-layout-store'
import { useBottomPanelRegionResize } from '../bottom-panel/use-bottom-panel-region-resize'

/** Frames and side-pane widths plus the Watches height; Variables keeps its minimum size. */
export function useDebugPanelResize() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const middleRef = useRef<HTMLDivElement | null>(null)
  const rootWidth = (): number => rootRef.current?.clientWidth ?? 0
  const framesResize = useBottomPanelRegionResize(
    'debugFramesWidth',
    'x',
    1,
    () =>
      rootWidth() - useBottomPanelLayout.getState().debugSidePaneWidth - DEBUG_MIN_VARIABLES_WIDTH
  )
  const sidePaneResize = useBottomPanelRegionResize(
    'debugSidePaneWidth',
    'x',
    -1,
    () => rootWidth() - useBottomPanelLayout.getState().debugFramesWidth - DEBUG_MIN_VARIABLES_WIDTH
  )
  const watchesResize = useBottomPanelRegionResize(
    'debugWatchesHeight',
    'y',
    -1,
    () => (middleRef.current?.clientHeight ?? 0) - DEBUG_MIN_VARIABLES_HEIGHT
  )
  return { rootRef, middleRef, framesResize, sidePaneResize, watchesResize }
}
