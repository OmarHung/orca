import { useAppStore } from '@/store'
import { usePluginLanguagePackStore } from '@/store/plugin-language-packs'
import { resolveUiLocale } from '@/i18n/supported-languages'
import { isPluginUiLanguage } from '../../../../shared/ui-language'

/**
 * BCP-47 tag of the UI language chosen in Settings, or null until settings load. Read from
 * settings rather than i18n: at startup i18n still holds the default while the catalog loads.
 */
export function useChangelogLocale(): string | null {
  const uiLanguage = useAppStore((state) => state.settings?.uiLanguage ?? null)
  const packs = usePluginLanguagePackStore((state) => state.packs)
  if (uiLanguage === null) {
    return null
  }
  if (isPluginUiLanguage(uiLanguage)) {
    return packs.find((pack) => pack.id === uiLanguage)?.locale ?? null
  }
  return resolveUiLocale(uiLanguage)
}
