import * as monaco from 'monaco-editor'
import type { editor, IDisposable } from 'monaco-editor'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { translate } from '@/i18n/i18n'
import { installDiffCommentZoneMouseDownStopper } from '../../diff-comments/diff-comment-zone-mouse-events'
import type { ChangeMarkerHunk } from './change-marker-hunks'
import type { ChangeMarkerWordRange } from './change-marker-word-diff'
import {
  ChangeMarkerPeekToolbar,
  type ChangeMarkerPeekToolbarProps
} from './ChangeMarkerPeekToolbar'

const HEADER_HEIGHT_PX = 28

export type ChangeMarkerPeekContent = {
  hunk: ChangeMarkerHunk
  originalWordRanges: readonly ChangeMarkerWordRange[]
  toolbar: ChangeMarkerPeekToolbarProps
}

export type ChangeMarkerPeek = {
  show: (content: ChangeMarkerPeekContent) => void
  dispose: () => void
}

function createDiv(className?: string): HTMLDivElement {
  const div = document.createElement('div')
  if (className) {
    div.className = className
  }
  return div
}

function buildSnippetDecorations(
  lineCount: number,
  wordRanges: readonly ChangeMarkerWordRange[]
): editor.IModelDeltaDecoration[] {
  const lines: editor.IModelDeltaDecoration[] = [
    {
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: lineCount, endColumn: 1 },
      options: {
        isWholeLine: true,
        className: 'orca-change-marker-original-line'
      }
    }
  ]
  const words = wordRanges.map((range) => ({
    range: {
      startLineNumber: range.line + 1,
      startColumn: range.startColumn,
      endLineNumber: range.line + 1,
      endColumn: range.endColumn
    },
    options: {
      inlineClassName: 'orca-change-marker-original-text'
    }
  }))
  return [...lines, ...words]
}

/**
 * The inline preview under a clicked marker: a toolbar row, then the HEAD lines
 * the hunk replaced in a read-only editor that shares the host's font metrics,
 * so old and new columns line up.
 */
export function createChangeMarkerPeek(
  host: editor.IStandaloneCodeEditor,
  languageId: string,
  onEscape: () => void
): ChangeMarkerPeek {
  const domNode = createDiv('orca-change-marker-peek')
  const header = createDiv()
  header.style.height = `${HEADER_HEIGHT_PX}px`
  header.style.width = 'max-content'
  const body = createDiv()
  domNode.append(header, body)
  const marginDomNode = createDiv('orca-change-marker-peek-margin')
  const marginHeader = createDiv()
  marginHeader.style.height = `${HEADER_HEIGHT_PX}px`
  const marginLines = createDiv('orca-change-marker-peek-margin-lines')
  marginDomNode.append(marginHeader, marginLines)

  const stopMouseDown = [
    installDiffCommentZoneMouseDownStopper(domNode),
    installDiffCommentZoneMouseDownStopper(marginDomNode)
  ]
  const toolbarRoot = createRoot(header)
  const zone: editor.IViewZone = {
    afterLineNumber: 0,
    heightInPx: HEADER_HEIGHT_PX,
    domNode,
    marginDomNode,
    suppressMouseDown: false
  }
  let zoneId: string | null = null
  let snippet: editor.IStandaloneCodeEditor | null = null
  let snippetModel: editor.ITextModel | null = null
  let snippetDecorations: editor.IEditorDecorationsCollection | null = null
  let lineCount = 0
  let disposed = false

  const fontInfo = (): editor.FontInfo => host.getOption(monaco.editor.EditorOption.fontInfo)
  const lineHeight = (): number => host.getOption(monaco.editor.EditorOption.lineHeight)

  // Why: the zone scrolls sideways with the code; keep the toolbar in view.
  const pinHeaderToViewport = (): void => {
    header.style.transform = `translateX(${host.getScrollLeft()}px)`
  }

  const layoutSnippet = (): void => {
    if (!snippet) {
      return
    }
    snippet.layout({
      width: Math.max(host.getScrollWidth(), host.getLayoutInfo().contentWidth),
      height: lineCount * lineHeight()
    })
  }

  const snippetFontOptions = (): editor.IEditorOptions => {
    const font = fontInfo()
    return {
      fontFamily: font.fontFamily,
      fontSize: font.fontSize,
      fontWeight: font.fontWeight,
      letterSpacing: font.letterSpacing,
      lineHeight: lineHeight()
    }
  }

  const ensureSnippet = (): { editor: editor.IStandaloneCodeEditor; model: editor.ITextModel } => {
    if (snippet && snippetModel) {
      return { editor: snippet, model: snippetModel }
    }
    const model = monaco.editor.createModel('', languageId)
    const created = monaco.editor.create(body, {
      ...snippetFontOptions(),
      model,
      ariaLabel: translate('changeMarkers.originalAriaLabel', 'Lines before this change'),
      readOnly: true,
      domReadOnly: true,
      automaticLayout: false,
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      minimap: { enabled: false },
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      renderLineHighlight: 'none',
      renderValidationDecorations: 'off',
      scrollBeyondLastLine: false,
      scrollBeyondLastColumn: 0,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'hidden',
        handleMouseWheel: false,
        alwaysConsumeMouseWheel: false,
        useShadows: false
      },
      wordWrap: 'off',
      contextmenu: false,
      links: false,
      hover: { enabled: false },
      occurrencesHighlight: 'off',
      selectionHighlight: false,
      matchBrackets: 'never',
      guides: { indentation: false },
      stickyScroll: { enabled: false },
      renderWhitespace: host.getOption(monaco.editor.EditorOption.renderWhitespace),
      padding: { top: 0, bottom: 0 }
    })
    created.onKeyDown((event) => {
      if (event.keyCode === monaco.KeyCode.Escape) {
        event.preventDefault()
        event.stopPropagation()
        onEscape()
      }
    })
    snippet = created
    snippetModel = model
    snippetDecorations = created.createDecorationsCollection()
    return { editor: created, model }
  }

  const renderMarginLines = (originalStartLine: number): void => {
    const layout = host.getLayoutInfo()
    const font = fontInfo()
    const height = lineHeight()
    marginLines.replaceChildren(
      ...Array.from({ length: lineCount }, (_, index) => {
        const row = createDiv()
        row.textContent = String(originalStartLine + index)
        row.style.width = `${layout.lineNumbersLeft + layout.lineNumbersWidth}px`
        row.style.height = `${height}px`
        row.style.lineHeight = `${height}px`
        row.style.fontFamily = font.fontFamily
        row.style.fontSize = `${font.fontSize}px`
        return row
      })
    )
    marginLines.style.height = `${lineCount * height}px`
  }

  const relayoutZone = (): void => {
    zone.heightInPx = HEADER_HEIGHT_PX + lineCount * lineHeight()
    body.style.height = `${lineCount * lineHeight()}px`
    host.changeViewZones((accessor) => {
      if (zoneId === null) {
        zoneId = accessor.addZone(zone)
      } else {
        accessor.layoutZone(zoneId)
      }
    })
    layoutSnippet()
  }

  const listeners: IDisposable[] = [
    host.onDidScrollChange((event) => {
      if (event.scrollLeftChanged) {
        pinHeaderToViewport()
      }
      if (event.scrollWidthChanged) {
        layoutSnippet()
      }
    }),
    host.onDidLayoutChange(layoutSnippet),
    host.onDidChangeConfiguration((event) => {
      if (
        zoneId === null ||
        !(
          event.hasChanged(monaco.editor.EditorOption.fontInfo) ||
          event.hasChanged(monaco.editor.EditorOption.lineHeight)
        )
      ) {
        return
      }
      snippet?.updateOptions(snippetFontOptions())
      relayoutZone()
    })
  ]

  return {
    show: ({ hunk, originalWordRanges, toolbar }) => {
      if (disposed) {
        return
      }
      lineCount = hunk.originalLines.length
      renderMarginLines(hunk.originalStartLine)
      zone.afterLineNumber = hunk.startLine - 1
      // Why first: the snippet editor must be created inside an attached container.
      relayoutZone()
      if (lineCount > 0) {
        const { model } = ensureSnippet()
        const text = hunk.originalLines.join('\n')
        if (model.getValue() !== text) {
          model.setValue(text)
        }
        const hostOptions = host.getModel()?.getOptions()
        if (hostOptions) {
          model.updateOptions({
            tabSize: hostOptions.tabSize,
            indentSize: hostOptions.indentSize,
            insertSpaces: hostOptions.insertSpaces
          })
        }
        snippetDecorations?.set(buildSnippetDecorations(lineCount, originalWordRanges))
        body.style.display = ''
        layoutSnippet()
      } else {
        body.style.display = 'none'
      }
      pinHeaderToViewport()
      toolbarRoot.render(createElement(ChangeMarkerPeekToolbar, toolbar))
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      for (const listener of listeners) {
        listener.dispose()
      }
      for (const dispose of stopMouseDown) {
        dispose()
      }
      if (zoneId !== null && host.getModel()) {
        const id = zoneId
        host.changeViewZones((accessor) => accessor.removeZone(id))
      }
      zoneId = null
      snippet?.dispose()
      snippetModel?.dispose()
      // Why: unmounting synchronously from inside a React commit warns and can drop the update.
      queueMicrotask(() => toolbarRoot.unmount())
    }
  }
}
