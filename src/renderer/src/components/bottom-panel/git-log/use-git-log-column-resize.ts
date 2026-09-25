import { useRef } from 'react'
import { GIT_LOG_MIN_TABLE_WIDTH, useBottomPanelLayout } from '../bottom-panel-layout-store'
import { useBottomPanelRegionResize } from '../use-bottom-panel-region-resize'

/** Branch tree and details widths; each may grow only while the commit table keeps its minimum. */
export function useGitLogColumnResize() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const rootWidth = (): number => rootRef.current?.clientWidth ?? 0
  const branchTreeResize = useBottomPanelRegionResize(
    'branchTreeWidth',
    'x',
    1,
    () => rootWidth() - useBottomPanelLayout.getState().detailsWidth - GIT_LOG_MIN_TABLE_WIDTH
  )
  const detailsResize = useBottomPanelRegionResize(
    'detailsWidth',
    'x',
    -1,
    () => rootWidth() - useBottomPanelLayout.getState().branchTreeWidth - GIT_LOG_MIN_TABLE_WIDTH
  )
  return { rootRef, branchTreeResize, detailsResize }
}
