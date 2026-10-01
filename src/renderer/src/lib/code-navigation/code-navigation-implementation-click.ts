import type * as Monaco from 'monaco-editor'
import { getShortcutPlatform } from '@/lib/shortcut-platform'

type ClickableEditor = Pick<
  Monaco.editor.ICodeEditor,
  'getContainerDomNode' | 'getTargetAtClientPoint' | 'setPosition' | 'focus' | 'trigger'
>

type ClickModifiers = Pick<MouseEvent, 'button' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

// Why: after a claimed pointerdown the compatibility mouse events may or may not follow.
const TRAILING_MOUSE_EVENT_MS = 500

/** JetBrains' Go to Implementation click: Cmd+Alt+click on macOS, Ctrl+Alt+click elsewhere. */
export function isImplementationClick(
  event: ClickModifiers,
  platform: NodeJS.Platform = getShortcutPlatform()
): boolean {
  if (event.button !== 0 || !event.altKey || event.shiftKey) {
    return false
  }
  return platform === 'darwin' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/**
 * Handles the Go to Implementation click on the editor's container in the capture phase, before
 * Monaco's own pointer handling sees it: Monaco would otherwise treat Cmd+Alt+click as "open the
 * definition to the side" (and its link gesture fires on the pointerup), so the whole gesture is
 * swallowed once claimed.
 */
export function installImplementationClick(
  editor: ClickableEditor,
  isEditorTab: () => boolean,
  onNavigate: () => void
): () => void {
  // Why the container: it exists from creation on, while the view's node is rebuilt per model.
  const node = editor.getContainerDomNode()
  let claimed = false
  let swallowMouseUntil = 0
  const swallow = (event: Event): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onPointerDown = (event: PointerEvent): void => {
    if (!isImplementationClick(event) || !isEditorTab()) {
      return
    }
    const position = editor.getTargetAtClientPoint(event.clientX, event.clientY)?.position
    if (!position) {
      return
    }
    swallow(event)
    claimed = true
    swallowMouseUntil = performance.now() + TRAILING_MOUSE_EVENT_MS
    editor.focus()
    editor.setPosition(position)
    onNavigate()
    editor.trigger('mouse', 'editor.action.goToImplementation', null)
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (claimed) {
      claimed = false
      swallowMouseUntil = performance.now() + TRAILING_MOUSE_EVENT_MS
      swallow(event)
    }
  }
  const onMouse = (event: MouseEvent): void => {
    if (performance.now() < swallowMouseUntil) {
      swallow(event)
    }
  }

  node.addEventListener('pointerdown', onPointerDown, true)
  node.addEventListener('pointerup', onPointerUp, true)
  node.addEventListener('mousedown', onMouse, true)
  node.addEventListener('mouseup', onMouse, true)
  return () => {
    node.removeEventListener('pointerdown', onPointerDown, true)
    node.removeEventListener('pointerup', onPointerUp, true)
    node.removeEventListener('mousedown', onMouse, true)
    node.removeEventListener('mouseup', onMouse, true)
  }
}
