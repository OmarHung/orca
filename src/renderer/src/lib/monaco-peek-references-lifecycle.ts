const openReferenceWidgets = new WeakSet<object>()
const closeListeners = new Set<() => void>()
let openReferenceWidgetCount = 0

export function markMonacoPeekReferencesOpen(widget: object): void {
  if (!openReferenceWidgets.has(widget)) {
    openReferenceWidgets.add(widget)
    openReferenceWidgetCount += 1
  }
}

export function markMonacoPeekReferencesClosed(widget: object): void {
  if (!openReferenceWidgets.delete(widget)) {
    return
  }
  openReferenceWidgetCount -= 1
  for (const listener of closeListeners) {
    listener()
  }
}

export function hasOpenMonacoPeekReferences(): boolean {
  return openReferenceWidgetCount > 0
}

export function onDidCloseMonacoPeekReferences(listener: () => void): () => void {
  closeListeners.add(listener)
  return () => {
    closeListeners.delete(listener)
  }
}
