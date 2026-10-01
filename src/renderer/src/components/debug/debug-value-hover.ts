import * as monaco from 'monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import { evaluateExpression } from './debug-evaluate'
import {
  hoverExpressionAt,
  selectionHoverExpression,
  type HoverExpression
} from './debug-hover-expression'
import type { EvaluateResult } from './debug-protocol-readers'

const WIDGET_ID = 'orca.debug.valueHover'
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
export type DebugHoverValue = HoverTarget & { result: EvaluateResult }

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
 * paused evaluates it and shows an expandable value under it. `domNode` is the popup's
 * container and `onChange` renders a value into it. Attach only while paused in this file.
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
  private readonly widget: editor.IContentWidget
  private readonly resizeObserver: ResizeObserver
  private readonly listeners: IDisposable[]

  constructor(
    private readonly codeEditor: editor.IStandaloneCodeEditor,
    domNode: HTMLElement,
    private readonly onChange: (value: DebugHoverValue | null) => void
  ) {
    this.widget = {
      allowEditorOverflow: true,
      getId: () => WIDGET_ID,
      getDomNode: () => domNode,
      getPosition: () => this.widgetPosition()
    }
    codeEditor.addContentWidget(this.widget)
    // Why: expanding a value grows the popup, and an above-the-line popup must move up for it.
    this.resizeObserver = new ResizeObserver(() => codeEditor.layoutContentWidget(this.widget))
    this.resizeObserver.observe(domNode)
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
    this.resizeObserver.disconnect()
    this.codeEditor.removeContentWidget(this.widget)
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

  private widgetPosition(): editor.IContentWidgetPosition | null {
    if (!this.shown) {
      return null
    }
    return {
      position: { lineNumber: this.shown.lineNumber, column: this.shown.startColumn },
      preference: [
        monaco.editor.ContentWidgetPositionPreference.BELOW,
        monaco.editor.ContentWidgetPositionPreference.ABOVE
      ]
    }
  }

  private listen(): IDisposable[] {
    const { codeEditor } = this
    return [
      codeEditor.onMouseMove((event) => this.onMouseMove(event)),
      codeEditor.onMouseLeave(() => this.pointTo(null)),
      codeEditor.onMouseDown((event) => {
        if (!this.isPopupTarget(event)) {
          this.hide()
        }
      }),
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
      codeEditor.onDidChangeModelContent(() => this.hide()),
      codeEditor.onDidChangeModel(() => this.hide())
    ]
  }

  private isPopupTarget(event: editor.IEditorMouseEvent): boolean {
    return (
      event.target.type === monaco.editor.MouseTargetType.CONTENT_WIDGET &&
      event.target.detail === WIDGET_ID
    )
  }

  private onMouseMove(event: editor.IEditorMouseEvent): void {
    if (this.isPopupTarget(event)) {
      return
    }
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
      if (id === this.request) {
        clearTimeout(this.hideTimer)
        this.setShown({ ...target, result })
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
    this.codeEditor.layoutContentWidget(this.widget)
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
