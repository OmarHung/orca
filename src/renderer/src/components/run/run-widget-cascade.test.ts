import { describe, expect, it } from 'vitest'
import { runWidgetCascadeDirection } from './run-widget-cascade'

describe('runWidgetCascadeDirection', () => {
  it('opens submenus toward the wider side of the window', () => {
    expect(runWidgetCascadeDirection({ left: 1400, width: 120 }, 1920)).toBe('rtl')
    expect(runWidgetCascadeDirection({ left: 300, width: 120 }, 1920)).toBe('ltr')
    expect(runWidgetCascadeDirection(undefined, 1920)).toBe('ltr')
  })
})
