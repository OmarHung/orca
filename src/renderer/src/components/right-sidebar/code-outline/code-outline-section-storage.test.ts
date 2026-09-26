import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CODE_OUTLINE_SECTION_HEIGHT,
  parseCodeOutlineSectionLayout
} from './code-outline-section-storage'

describe('parseCodeOutlineSectionLayout', () => {
  it('keeps a valid saved layout', () => {
    expect(parseCodeOutlineSectionLayout({ collapsed: true, height: 310 })).toEqual({
      collapsed: true,
      height: 310
    })
  })

  it('falls back field by field for missing or corrupt values', () => {
    expect(parseCodeOutlineSectionLayout({ collapsed: 'yes', height: -4 })).toEqual({
      collapsed: false,
      height: DEFAULT_CODE_OUTLINE_SECTION_HEIGHT
    })
    expect(parseCodeOutlineSectionLayout(null)).toEqual({
      collapsed: false,
      height: DEFAULT_CODE_OUTLINE_SECTION_HEIGHT
    })
  })
})
