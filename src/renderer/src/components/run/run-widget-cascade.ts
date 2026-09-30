import type { CSSProperties } from 'react'

/**
 * Which way the Run widget's submenus open: toward the wider side of the window. Radix only flips
 * a submenu that collides, so near the right edge levels would zig-zag over their parents.
 */
export function runWidgetCascadeDirection(
  trigger: { left: number; width: number } | undefined,
  viewportWidth: number
): 'ltr' | 'rtl' {
  if (!trigger) {
    return 'ltr'
  }
  return trigger.left + trigger.width / 2 > viewportWidth / 2 ? 'rtl' : 'ltr'
}

// Why: the menu root may be dir="rtl" to cascade submenus leftward; its text stays left-to-right.
export const RUN_WIDGET_CONTENT_STYLE: CSSProperties = { direction: 'ltr' }
