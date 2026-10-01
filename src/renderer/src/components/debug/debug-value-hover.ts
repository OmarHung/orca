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
 * Once shown it stays until `close()` (a click outside or Escape) or until its text leaves
 * the view or changes. Attach only while paused in this file.
 */
export class DebugValueHover implements IDisposable {
  private shown: DebugHoverValue | null = null
  /** The target last under the pointer; not tracked while a popup is shown. */
  private pointerKey: string | null = null
  private failedKeys: ReadonlySet<string> = new Set()
  private request = 0
  private showTimer: ReturnType<typeof setTimeout> | undefined
  /** The editor's own hover setting while this popup holds it off, else null. */
  private suppressedHoverEnabled: boolean | null = null
  private readonly listeners: IDisposable[]

  constructor(
    private readonly codeEditor: editor.IStandaloneCodeEditor,
    /** The session paused in this editor's file; values come from its selected frame. */
    private readonly sessionId: string,
    private readonly onChange: (value: DebugHoverValue | null) => void
  ) {
    this.listeners = this.listen()
  }

  close(): void {
    clearTimeout(this.showTimer)
    this.request++
    if (this.shown) {
      // Treated as still pointed at, so it reopens only after the pointer leaves and returns.
      this.pointerKey = keyOf(this.shown)
      this.setShown(null)
    }
  }

  dispose(): void {
    this.close()
    this.restoreEditorHover()
    this.listeners.forEach((listener) => listener.dispose())
  }

  /** The target's box in window coordinates, or null when it is scrolled out of view. */
  private anchorOf(target: HoverTarget): HoverAnchor | null {
    const visible = this.codeEditor.getScrolledVisiblePosition({
      lineNumber: target.lineNumber,
      column: target.startColumn
    })
    const box = this.codeEditor.getDomNode()?.getBoundingClientRect()
    const layout = this.codeEditor.getLayoutInfo()
    if (
      !visible ||
      !box ||
      visible.top < 0 ||
      visible.top + visible.height > layout.height ||
      visible.left < layout.contentLeft ||
      visible.left > layout.width
    ) {
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
      codeEditor.onDidScrollChange(() => this.followText()),
      codeEditor.onDidLayoutChange(() => this.followText()),
      // Edited text no longer matches the value.
      codeEditor.onDidChangeModelContent(() => this.close()),
      codeEditor.onDidChangeModel(() => this.close())
    ]
  }

  /** Keeps the popup on its text as the editor scrolls or resizes. */
  private followText(): void {
    if (!this.shown) {
      return
    }
    const anchor = this.anchorOf(this.shown)
    if (anchor) {
      this.setShown({ ...this.shown, anchor })
    } else {
      this.close()
    }
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
    // An open popup is pinned: other names wait until it is closed.
    if (this.shown || key === this.pointerKey) {
      return
    }
    this.pointerKey = key
    clearTimeout(this.showTimer)
    this.request++
    if (!target || !key || this.failedKeys.has(key)) {
      this.restoreEditorHover()
      return
    }
    this.suppressEditorHover()
    const id = this.request
    this.showTimer = setTimeout(() => void this.evaluate(target, id), SHOW_DELAY_MS)
  }

  private async evaluate(target: HoverTarget, id: number): Promise<void> {
    try {
      const result = await evaluateExpression(this.sessionId, target.expression, 'hover')
      const anchor = this.anchorOf(target)
      if (id === this.request && anchor) {
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
