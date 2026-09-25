import { describe, expect, it } from 'vitest'
import { BOTTOM_PANEL_SIZE_LIMITS, clampBottomPanelSize } from './bottom-panel-layout-store'
import { clampDragSize } from './use-drag-resize'

describe('clampBottomPanelSize', () => {
  it('falls back to the default for missing or corrupt stored values', () => {
    expect(clampBottomPanelSize('detailsWidth', undefined)).toBe(
      BOTTOM_PANEL_SIZE_LIMITS.detailsWidth.fallback
    )
    expect(clampBottomPanelSize('height', 'tall')).toBe(BOTTOM_PANEL_SIZE_LIMITS.height.fallback)
    expect(clampBottomPanelSize('height', Number.NaN)).toBe(
      BOTTOM_PANEL_SIZE_LIMITS.height.fallback
    )
  })

  it('clamps into the key limits', () => {
    expect(clampBottomPanelSize('branchTreeWidth', 10)).toBe(
      BOTTOM_PANEL_SIZE_LIMITS.branchTreeWidth.min
    )
    expect(clampBottomPanelSize('messageHeight', 99_999)).toBe(
      BOTTOM_PANEL_SIZE_LIMITS.messageHeight.max
    )
  })
})

describe('clampDragSize', () => {
  it('keeps the size between min and the container-derived max', () => {
    expect(clampDragSize(50, 100, 400)).toBe(100)
    expect(clampDragSize(500, 100, 400)).toBe(400)
    expect(clampDragSize(250, 100, 400)).toBe(250)
  })

  it('never goes below min when the container is too small to honor max', () => {
    expect(clampDragSize(300, 100, 40)).toBe(100)
  })
})
