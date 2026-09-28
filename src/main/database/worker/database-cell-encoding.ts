/** A value as the text the grid shows, whole; the dispatcher cuts long ones to a preview. */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return typeof value === 'string' ? value : String(value)
}
