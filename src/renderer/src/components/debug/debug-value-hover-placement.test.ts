import { describe, expect, it } from 'vitest'
import { MAX_POPUP_HEIGHT_PX, placeValuePopup } from './debug-value-hover-placement'

const VIEWPORT = { width: 1000, height: 800 }

describe('placeValuePopup', () => {
  it('opens under the hovered text when it fits', () => {
    expect(
      placeValuePopup({ left: 100, top: 200, bottom: 220 }, { width: 300, height: 120 }, VIEWPORT)
    ).toEqual({ left: 100, top: 220, maxHeight: MAX_POPUP_HEIGHT_PX })
  })

  it('opens above the text near the bottom of the window', () => {
    expect(
      placeValuePopup({ left: 100, top: 700, bottom: 720 }, { width: 300, height: 200 }, VIEWPORT)
    ).toEqual({ left: 100, top: 500, maxHeight: MAX_POPUP_HEIGHT_PX })
  })

  it('scrolls on the roomier side when neither side fits', () => {
    const placement = placeValuePopup(
      { left: 100, top: 150, bottom: 170 },
      { width: 300, height: 600 },
      { width: 1000, height: 400 }
    )
    expect(placement).toEqual({ left: 100, top: 170, maxHeight: 222 })
  })

  it('stays inside the right edge of the window', () => {
    expect(
      placeValuePopup({ left: 900, top: 200, bottom: 220 }, { width: 300, height: 50 }, VIEWPORT)
        .left
    ).toBe(692)
  })
})
