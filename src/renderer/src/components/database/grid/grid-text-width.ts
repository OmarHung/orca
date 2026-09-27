import { estimateGridTextWidth } from './database-grid-columns'

let context: CanvasRenderingContext2D | null | undefined

function measuringContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) {
    return context
  }
  context = document.createElement('canvas').getContext('2d')
  if (context) {
    // Why a probe: read the font the grid's cells actually render with, not a guess of it.
    const probe = document.createElement('span')
    probe.className = 'font-mono text-xs'
    document.body.append(probe)
    const style = getComputedStyle(probe)
    context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    probe.remove()
  }
  return context
}

/** Rendered width of `text` in the grid's cell font, in CSS pixels. */
export function gridTextWidth(text: string): number {
  return measuringContext()?.measureText(text).width ?? estimateGridTextWidth(text)
}
