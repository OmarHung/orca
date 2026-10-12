// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import { mondayHtmlToText, mondayImagesAsLinks, mondayLinkFromClick } from './monday-update-html'

// DOMPurify itself is not exercised here: under happy-dom it mis-sanitizes (it works in Chromium).
describe('mondayImagesAsLinks', () => {
  it('turns images into links and keeps the text around them', () => {
    const html = mondayImagesAsLinks(
      '已結案<br><img src="https://acme.monday.com/protected_static/1/x.png" data-asset_id="3">',
      'Image'
    )
    expect(html).toBe(
      '已結案<br><a href="https://acme.monday.com/protected_static/1/x.png">Image</a>'
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

describe('mondayHtmlToText', () => {
  it('keeps line breaks, list items and the full address behind shortened links', () => {
    const text = mondayHtmlToText(
      '<p>選單沒有顯示<br>請協助確認</p>' +
        '<p><a href="https://shop.example.com/products/%E9%A6%99">https://shop.example.com/pro…</a></p>' +
        '<ul><li>第一點</li><li>第二點</li></ul>',
      '[圖片]'
    )
    expect(text).toBe(
      '選單沒有顯示\n請協助確認\nhttps://shop.example.com/products/%E9%A6%99\n- 第一點\n- 第二點'
    )
  })

  it('puts each image on its own line and names links by their address, mentions not', () => {
    const text = mondayHtmlToText(
      '<a href="https://acme.monday.com/users/1">@Alice</a> see <a href="https://docs.example.com/a">the doc</a>' +
        '<img src="https://acme.monday.com/protected_static/1/x.png">',
      '[Image]'
    )
    expect(text).toBe(
      '@Alice see the doc (https://docs.example.com/a)\n[Image] https://acme.monday.com/protected_static/1/x.png'
    )
  })

  it('leaves out script and style text', () => {
    expect(
      mondayHtmlToText('<p>ok</p><script>window.x = 1</script><style>p{}</style>', '[Image]')
    ).toBe('ok')
  })

  it('keeps the blank line monday writes as an empty paragraph', () => {
    expect(mondayHtmlToText('<p>第一行</p><p><br></p><p>第三行</p>', '[Image]')).toBe(
      '第一行\n\n第三行'
    )
  })
})
