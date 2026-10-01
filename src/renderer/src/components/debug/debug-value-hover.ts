import * as monaco from 'monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import { evaluateExpression } from './debug-evaluate'
import {
  hoverExpressionAt,
  selectionHoverExpression,
  type HoverExpression
} from './debug-hover-expression'
import type { EvaluateResult } from './debug-protocol-readers'
import type { HoverAnchor } from './debug-value-hover-placement'

/** How long the pointer rests on a name before it is evaluated (Monaco's own hover delay). */
const SHOW_DELAY_MS = 300
/** Time to move the pointer from the name into the popup before it closes. */
const HIDE_DELAY_MS = 300
const MODIFIER_KEYS = new Set([
  monaco.KeyCode.Ctrl,
  monaco.KeyCode.Alt,
  monaco.KeyCode.Meta,
  monaco.KeyCode.Shift
])

type HoverTarget = HoverExpression & { lineNumber: number }
export type DebugHoverValue = HoverTarget & { result: EvaluateResult; anchor: HoverAnchor }

const keyOf = (target: HoverTarget): string =>
  `${target.lineNumber}:${target.startColumn}:${target.expression}`

/** The hovered selection when the pointer is inside it, else the name under the pointer. */
function targetAt(
  codeEditor: editor.IStandaloneCodeEditor,
  position: monaco.Position
): HoverTarget | null {
  const model = codeEditor.getModel()
  if (!model) {
    return null
  }
  const selection = codeEditor.getSelection()
  if (selection && !selection.isEmpty() && selection.containsPosition(position)) {
    const target = selectionHoverExpression(model.getValueInRange(selection), selection.startColumn)
    return target ? { ...target, lineNumber: selection.startLineNumber } : null
  }
  const target = hoverExpressionAt(model.getLineContent(position.lineNumber), position.column)
  return target ? { ...target, lineNumber: position.lineNumber } : null
}

/**
 * JetBrains-style value popup: resting the pointer on a name (or inside a selection) while
 * paused evaluates it; `onChange` renders the value (or null) as a popup at its anchor.
 * Attach only while paused in this file.
 */
export class DebugValueHover implements IDisposable {
  private shown: DebugHoverValue | null = null
  /** The target under the pointer; kept while the pointer is inside the popup. */
  private pointerKey: string | null = null
  private failedKeys: ReadonlySet<string> = new Set()
  private pointerInPopup = false
  private request = 0
  private showTimer: ReturnType<typeof setTimeout> | undefined
  private hideTimer: ReturnType<typeof setTimeout> | undefined
  /** The editor's own hover setting while this popup holds it off, else null. */
  private suppressedHoverEnabled: boolean | null = null
  private readonly listeners: IDisposable[]

  constructor(
    private readonly codeEditor: editor.IStandaloneCodeEditor,
    private readonly onChange: (value: DebugHoverValue | null) => void
  ) {
    this.listeners = this.listen()
  }

  setPointerInPopup(inside: boolean): void {
    this.pointerInPopup = inside
    if (!inside) {
      this.scheduleHide()
      return
    }
    // Crossing another name on the way into the popup must not replace it.
    clearTimeout(this.showTimer)
    clearTimeout(this.hideTimer)
    this.request++
    this.pointerKey = this.shown ? keyOf(this.shown) : null
  }

  dispose(): void {
    this.hide()
    this.listeners.forEach((listener) => listener.dispose())
  }

  private hide(): void {
    clearTimeout(this.showTimer)
    clearTimeout(this.hideTimer)
    this.request++
    this.pointerKey = null
    this.pointerInPopup = false
    this.restoreEditorHover()
    if (this.shown) {
      this.setShown(null)
    }
  }

  /** The target's box in window coordinates; the popup lives outside the editor's DOM. */
  private anchorOf(target: HoverTarget): HoverAnchor | null {
    const visible = this.codeEditor.getScrolledVisiblePosition({
      lineNumber: target.lineNumber,
      column: target.startColumn
    })
    const box = this.codeEditor.getDomNode()?.getBoundingClientRect()
    if (!visible || !box) {
      return null
    }
    const top = box.top + visible.top
    return { left: box.left + visible.left, top, bottom: top + visible.height }
  }

  private listen(): IDisposable[] {
    const { codeEditor } = this
    return [
      codeEditor.onMouseMove((event) => this.onMouseMove(event)),
      codeEditor.onMouseLeave(() => this.pointTo(null)),
      codeEditor.onMouseDown(() => this.hide()),
      codeEditor.onKeyDown((event) => {
        if (this.shown && !MODIFIER_KEYS.has(event.keyCode)) {
          this.hide()
        }
      }),
      codeEditor.onDidScrollChange((event) => {
        if (event.scrollTopChanged || event.scrollLeftChanged) {
          this.hide()
        }
      }),
      // The anchor is a snapshot, so anything that moves the text closes the popup.
      codeEditor.onDidLayoutChange(() => this.hide()),
      codeEditor.onDidChangeModelContent(() => this.hide()),
      codeEditor.onDidChangeModel(() => this.hide())
    ]
  }

  private onMouseMove(event: editor.IEditorMouseEvent): void {
    const { target } = event
    const position = target.type === monaco.editor.MouseTargetType.CONTENT_TEXT && target.position
    // Nothing while a drag selects text; holding Alt shows the language hover, like VS Code.
    const idle = event.event.buttons === 0 && !event.event.altKey
    this.pointTo(position && idle ? targetAt(this.codeEditor, position) : null)
  }

  private pointTo(target: HoverTarget | null): void {
    const key = target ? keyOf(target) : null
    if (key === this.pointerKey) {
      return
    }
    this.pointerKey = key
    clearTimeout(this.showTimer)
    this.request++
    if (!target || !key || this.failedKeys.has(key)) {
      this.restoreEditorHover()
      this.scheduleHide()
      return
    }
    this.suppressEditorHover()
    if (this.shown && keyOf(this.shown) === key) {
      clearTimeout(this.hideTimer)
      return
    }
    this.scheduleHide()
    const id = this.request
    this.showTimer = setTimeout(() => void this.evaluate(target, id), SHOW_DELAY_MS)
  }

  private async evaluate(target: HoverTarget, id: number): Promise<void> {
    try {
      const result = await evaluateExpression(target.expression, 'hover')
      const anchor = this.anchorOf(target)
      if (id === this.request && anchor) {
        clearTimeout(this.hideTimer)
        this.setShown({ ...target, result, anchor })
      }
    } catch {
      // Not every name is a value (keywords, types, out-of-scope names): give it back to the
      // language hover and don't ask again during this pause.
      if (id === this.request) {
        this.failedKeys = new Set([...this.failedKeys, keyOf(target)])
        this.restoreEditorHover()
      }
    }
  }

  private scheduleHide(): void {
    if (!this.shown) {
      return
    }
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      const pointerOnShown = this.shown !== null && this.pointerKey === keyOf(this.shown)
      if (!this.pointerInPopup && !pointerOnShown) {
        this.setShown(null)
      }
    }, HIDE_DELAY_MS)
  }

  private setShown(value: DebugHoverValue | null): void {
    this.shown = value
    this.onChange(value)
  }

  // Why: the language hover (types, docs) would stack on the value popup; JetBrains shows one.
  private suppressEditorHover(): void {
    if (this.suppressedHoverEnabled === null) {
      this.suppressedHoverEnabled = this.codeEditor.getOption(
        monaco.editor.EditorOption.hover
      ).enabled
      this.codeEditor.updateOptions({ hover: { enabled: false } })
    }
  }

  private restoreEditorHover(): void {
    if (this.suppressedHoverEnabled !== null) {
      this.codeEditor.updateOptions({ hover: { enabled: this.suppressedHoverEnabled } })
      this.suppressedHoverEnabled = null
    }
  }
}
