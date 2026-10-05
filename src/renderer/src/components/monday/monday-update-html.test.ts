// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mondayImagesAsLinks, mondayLinkFromClick } from './monday-update-html'

// DOMPurify itself is not exercised here: under happy-dom it mis-sanitizes (it works in Chromium).
describe('mondayImagesAsLinks', () => {
  it('turns images into links and keeps the text around them', () => {
    const html = mondayImagesAsLinks(
      '已結案<br><img src="https://autrontech.monday.com/protected_static/1/x.png" data-asset_id="3">',
      'Image'
    )
    expect(html).toBe(
      '已結案<br><a href="https://autrontech.monday.com/protected_static/1/x.png">Image</a>'
    )
  })
})

describe('mondayLinkFromClick', () => {
  it('finds the enclosing http link', () => {
    const anchor = document.createElement('a')
    anchor.setAttribute('href', 'https://monday.com')
    const inner = document.createElement('span')
    anchor.appendChild(inner)
    expect(mondayLinkFromClick(inner)).toBe('https://monday.com')
    expect(mondayLinkFromClick(document.createElement('p'))).toBeNull()
  })
})
