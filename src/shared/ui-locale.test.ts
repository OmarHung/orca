import { describe, expect, it } from 'vitest'

import {
  normalizeSupportedUiLocale,
  resolveUiLocale,
  detectUiLanguage,
  normalizeUiLocaleTag,
  shouldShowLanguageSwitcher
} from './ui-locale'
import { UI_LANGUAGE_CHINESE_TRADITIONAL, UI_LANGUAGE_SYSTEM } from './ui-language'

describe('ui-locale', () => {
  it('maps Traditional Chinese system locales to the Traditional catalog', () => {
    expect(normalizeSupportedUiLocale('zh-TW')).toBe('zh-TW')
    expect(normalizeSupportedUiLocale('zh-HK')).toBe('zh-TW')
    expect(normalizeSupportedUiLocale('zh-MO')).toBe('zh-TW')
    expect(normalizeSupportedUiLocale('zh-Hant')).toBe('zh-TW')
    expect(normalizeSupportedUiLocale('zh_Hant_TW')).toBe('zh-TW')
  })

  it('resolves explicit Traditional Chinese independently of system locale', () => {
    expect(resolveUiLocale(UI_LANGUAGE_CHINESE_TRADITIONAL, 'en-US')).toBe('zh-TW')
    expect(resolveUiLocale(UI_LANGUAGE_SYSTEM, 'zh-TW')).toBe('zh-TW')
  })

  it('preserves a selected plugin language bundle id', () => {
    expect(resolveUiLocale('plugin:orca-samples.portuguese/pt-BR')).toBe(
      'plugin:orca-samples.portuguese/pt-BR'
    )
  })
})

describe('system language detection', () => {
  it.each([
    ['en-US', 'en', 'supported'],
    ['fr_CA.UTF-8', 'fr', 'supported'],
    ['pt-PT', 'pt', 'supported'],
    ['zh-Hans-TW', 'zh', 'supported'],
    ['zh-Hant-CN', 'zh-TW', 'supported'],
    ['zh-Latn-CN', 'en', 'unsupported'],
    ['zh-MO', 'zh-TW', 'supported'],
    ['zh_CN.UTF-8@hant', 'zh-TW', 'supported'],
    ['zh_TW.UTF-8@hans', 'zh', 'supported'],
    ['de-DE', 'en', 'unsupported'],
    ['en--US', 'en', 'unknown'],
    ['C.UTF-8', 'en', 'unknown'],
    ['POSIX', 'en', 'unknown']
  ])('resolves %s without confusing a fallback with detected English', (tag, locale, status) => {
    expect(detectUiLanguage([tag], 'native')).toMatchObject({ locale, status })
  })

  it('retains an unsupported primary instead of using a supported secondary', () => {
    expect(detectUiLanguage(['de-DE', 'fr-FR', 'C'], 'native')).toMatchObject({
      detectedTag: 'de-DE',
      locale: 'en',
      status: 'unsupported'
    })
  })

  it('hides only confident English and respects language order', () => {
    const english = detectUiLanguage(['en-GB', 'zh-CN'], 'native')
    expect(shouldShowLanguageSwitcher(english)).toBe(false)
    expect(shouldShowLanguageSwitcher(detectUiLanguage(['en'], 'browser-fallback'))).toBe(true)
    expect(shouldShowLanguageSwitcher(detectUiLanguage(['C', 'garbage!'], 'native'))).toBe(true)
    expect(shouldShowLanguageSwitcher(detectUiLanguage(['zh-CN', 'en-GB'], 'native'))).toBe(true)
  })

  it('preserves script modifiers while normalizing POSIX locales', () => {
    expect(normalizeUiLocaleTag('sr_RS.UTF-8@latin')).toBe('sr-Latn-RS')
    expect(normalizeUiLocaleTag('sr_RS@cyrillic')).toBe('sr-Cyrl-RS')
  })
})
