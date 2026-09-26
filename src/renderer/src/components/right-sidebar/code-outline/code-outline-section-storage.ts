// Why: section layout is a per-device view preference, not host state, so it stays out of `ui.set`.
const STORAGE_KEY = 'orca.explorer.structure-section.v1'

export const DEFAULT_CODE_OUTLINE_SECTION_HEIGHT = 240

export type CodeOutlineSectionLayout = { collapsed: boolean; height: number }

const DEFAULT_LAYOUT: CodeOutlineSectionLayout = {
  collapsed: false,
  height: DEFAULT_CODE_OUTLINE_SECTION_HEIGHT
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function parseCodeOutlineSectionLayout(value: unknown): CodeOutlineSectionLayout {
  if (!isRecord(value)) {
    return DEFAULT_LAYOUT
  }
  return {
    collapsed: typeof value.collapsed === 'boolean' ? value.collapsed : DEFAULT_LAYOUT.collapsed,
    height:
      typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0
        ? value.height
        : DEFAULT_LAYOUT.height
  }
}

export function loadCodeOutlineSectionLayout(): CodeOutlineSectionLayout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return parseCodeOutlineSectionLayout(raw ? JSON.parse(raw) : undefined)
  } catch {
    return DEFAULT_LAYOUT
  }
}

export function saveCodeOutlineSectionLayout(layout: CodeOutlineSectionLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // The section stays usable when browser storage is unavailable or full.
  }
}
