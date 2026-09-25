// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { useBottomPanelLayout } from './bottom-panel-layout-store'

const STORAGE_KEY = 'orca.bottomPanel.layout.v1'

function storedAuthorWidth(): unknown {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw ? JSON.parse(raw).authorColumnWidth : undefined
}

describe('bottom panel layout store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('shows a previewed size immediately without persisting it', () => {
    useBottomPanelLayout.getState().previewSize('authorColumnWidth', 210)
    expect(useBottomPanelLayout.getState().authorColumnWidth).toBe(210)
    expect(storedAuthorWidth()).toBeUndefined()
  })

  it('persists the size committed on release', () => {
    useBottomPanelLayout.getState().previewSize('authorColumnWidth', 210)
    useBottomPanelLayout.getState().setSize('authorColumnWidth', 230)
    expect(storedAuthorWidth()).toBe(230)
  })
})
