import { describe, expect, it } from 'vitest'

import { normalizeUiLanguage } from './ui-language'

describe('normalizeUiLanguage', () => {
  it('keeps the Traditional Chinese choice older fork builds stored as zh-TW', () => {
    expect(normalizeUiLanguage('zh-TW')).toBe('zh-Hant')
  })
})
