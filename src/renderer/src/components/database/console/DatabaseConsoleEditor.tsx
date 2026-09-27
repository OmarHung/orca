import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as MonacoApi from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { installMonacoEditorFindShortcut } from '@/components/editor/editor-shortcuts'
import { monacoFindOptions } from '@/components/editor/monaco-find-options'
import { translate } from '@/i18n/i18n'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { resolveDocumentTheme } from '@/lib/document-theme'
import '@/lib/monaco-setup'
import { useAppStore } from '@/store'
import { statementsForRun, type DatabaseRunMode } from './database-console-statements'
import {
  databaseConsoleModelPath,
  registerDatabaseConsoleModel
} from './monaco-database-console-language'
import type {
  SqlDialect,
  SqlStatementRange
} from '../../../../../shared/database/sql-statement-splitter'

type Monaco = typeof MonacoApi

const MARKER_OWNER = 'orca-database'

type DatabaseConsoleEditorProps = {
  tabId: string
  connectionId: string
  initialText: string
  dialect: SqlDialect
  errorOffset: number | null
  onChange: (text: string) => void
  onRun: (statements: SqlStatementRange[]) => void
  /** Hands the editor to toolbar buttons that run from the caret. */
  onEditorReady: (instance: editor.ICodeEditor | null) => void
}

function buildOptions(
  fontFamily: string,
  fontSize: number
): editor.IStandaloneEditorConstructionOptions {
  return {
    ariaLabel: translate('database.console.editorLabel', 'SQL console'),
    automaticLayout: true,
    find: monacoFindOptions,
    fontFamily,
    fontSize,
    minimap: { enabled: false },
    padding: { top: 8, bottom: 8 },
    scrollBeyondLastLine: false,
    scrollbar: { horizontalScrollbarSize: 8, verticalScrollbarSize: 8 },
    stickyScroll: { enabled: false },
    tabSize: 2,
    wordWrap: 'off'
  }
}

function runFromEditor(
  instance: editor.ICodeEditor,
  mode: DatabaseRunMode,
  dialect: SqlDialect,
  onRun: (statements: SqlStatementRange[]) => void
): void {
  const model = instance.getModel()
  const selection = instance.getSelection()
  if (!model || !selection) {
    return
  }
  const statements = statementsForRun(
    model.getValue(),
    mode,
    model.getOffsetAt(selection.getPosition()),
    selection.isEmpty()
      ? null
      : {
          start: model.getOffsetAt(selection.getStartPosition()),
          end: model.getOffsetAt(selection.getEndPosition())
        },
    dialect
  )
  onRun(statements)
}

export function DatabaseConsoleEditor({
  tabId,
  connectionId,
  initialText,
  dialect,
  errorOffset,
  onChange,
  onRun,
  onEditorReady
}: DatabaseConsoleEditorProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const editorFontZoomLevel = useAppStore((state) => state.editorFontZoomLevel)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const onRunRef = useRef(onRun)
  const onEditorReadyRef = useRef(onEditorReady)
  const dialectRef = useRef(dialect)
  const connectionIdRef = useRef(connectionId)
  useLayoutEffect(() => {
    onRunRef.current = onRun
    onEditorReadyRef.current = onEditorReady
    dialectRef.current = dialect
    connectionIdRef.current = connectionId
  }, [onRun, onEditorReady, dialect, connectionId])

  const fontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const fontFamily = resolveEditorFontFamily(settings)
  const isDark = resolveDocumentTheme(settings?.theme ?? 'system')
  const options = useMemo(() => buildOptions(fontFamily, fontSize), [fontFamily, fontSize])

  const handleMount = useCallback<OnMount>((instance, monaco) => {
    editorRef.current = instance
    monacoRef.current = monaco
    const cleanupFind = installMonacoEditorFindShortcut(instance)
    const model = instance.getModel()
    const unregisterModel = model
      ? registerDatabaseConsoleModel(monaco, model, () => ({
          connectionId: connectionIdRef.current,
          dialect: dialectRef.current
        }))
      : () => {}
    // CtrlCmd is ⌘ on macOS and Ctrl elsewhere.
    instance.addAction({
      id: 'orca.database.runStatement',
      label: translate('database.console.runStatement', 'Run Statement'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: (target) => runFromEditor(target, 'current', dialectRef.current, onRunRef.current)
    })
    instance.addAction({
      id: 'orca.database.runAll',
      label: translate('database.console.runAll', 'Run All Statements'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: (target) => runFromEditor(target, 'all', dialectRef.current, onRunRef.current)
    })
    instance.addAction({
      id: 'orca.database.reformat',
      label: translate('database.console.reformat', 'Reformat SQL'),
      // DataGrip's Reformat Code.
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyL],
      run: (target) =>
        target
          .getAction(
            target.getSelection()?.isEmpty() === false
              ? 'editor.action.formatSelection'
              : 'editor.action.formatDocument'
          )
          ?.run()
    })
    instance.focus()
    onEditorReadyRef.current(instance)
    instance.onDidDispose(() => {
      cleanupFind()
      unregisterModel()
      editorRef.current = null
      onEditorReadyRef.current(null)
    })
  }, [])

  useEffect(() => {
    const instance = editorRef.current
    const monaco = monacoRef.current
    const model = instance?.getModel()
    if (!monaco || !model) {
      return
    }
    if (errorOffset === null) {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
      return
    }
    const position = model.getPositionAt(errorOffset)
    const word = model.getWordAtPosition(position)
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [
      {
        severity: monaco.MarkerSeverity.Error,
        message: translate('database.console.errorMarker', 'The server reported an error here'),
        startLineNumber: position.lineNumber,
        startColumn: word?.startColumn ?? position.column,
        endLineNumber: position.lineNumber,
        endColumn: word?.endColumn ?? position.column + 1
      }
    ])
    instance?.revealPositionInCenterIfOutsideViewport(position)
  }, [errorOffset])

  return (
    <div className="relative h-full min-h-0 bg-editor-surface">
      <div className="absolute inset-0">
        <Editor
          height="100%"
          defaultLanguage="sql"
          defaultPath={databaseConsoleModelPath(tabId)}
          // Why defaultValue: this editor owns its text after mount, so React never resets undo.
          defaultValue={initialText}
          theme={isDark ? 'vs-dark' : 'vs'}
          onChange={(value) => onChange(value ?? '')}
          onMount={handleMount}
          options={options}
          loading={<div className="h-full w-full bg-editor-surface" aria-hidden="true" />}
        />
      </div>
    </div>
  )
}

export function runDatabaseConsoleFromToolbar(
  instance: editor.ICodeEditor | null,
  mode: DatabaseRunMode,
  dialect: SqlDialect,
  onRun: (statements: SqlStatementRange[]) => void
): void {
  if (instance) {
    runFromEditor(instance, mode, dialect, onRun)
  }
}
