import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as MonacoApi from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { installMonacoEditorFindShortcut } from '@/components/editor/editor-shortcuts'
import { monacoFindOptions } from '@/components/editor/monaco-find-options'
import { translate } from '@/i18n/i18n'
import { computeEditorFontSize } from '../../../../../shared/editor/editor-font-zoom'
import { resolveEditorFontFamily } from '../../../../../shared/editor/editor-typography'
import { resolveDocumentTheme } from '@/app-shell/appearance/document-theme'
import '@/lib/editor/monaco/monaco-setup'
import { useAppStore } from '@/store'
import {
  statementsForRun,
  type DatabaseConsoleLanguage,
  type DatabaseRunMode
} from './database-console-statements'
import {
  databaseConsoleModelPath,
  monacoLanguageFor,
  registerDatabaseConsoleModel
} from './monaco-database-console-language'
import { DATABASE_DRIVER_NAMES } from '../../../../../shared/database/database-connection-types'
import type { SqlStatementRange } from '../../../../../shared/database/sql-statement-splitter'

type Monaco = typeof MonacoApi

const MARKER_OWNER = 'orca-database'

type DatabaseConsoleEditorProps = {
  tabId: string
  connectionId: string
  /** The console's picked schema, for completion; null is the connection's default. */
  schema: string | null
  database: string | null
  initialText: string
  language: DatabaseConsoleLanguage
  errorOffset: number | null
  onChange: (text: string) => void
  onRun: (statements: SqlStatementRange[]) => void
  onShowHistory: () => void
  /** Hands the editor to toolbar buttons that run from the caret. */
  onEditorReady: (instance: editor.ICodeEditor | null) => void
}

function editorLabel(language: DatabaseConsoleLanguage): string {
  return language === 'redis' || language === 'mongodb'
    ? translate('database.console.editorLabelFor', '{{value0}} console', {
        value0: DATABASE_DRIVER_NAMES[language]
      })
    : translate('database.console.editorLabel', 'SQL console')
}

function buildOptions(
  fontFamily: string,
  fontSize: number,
  language: DatabaseConsoleLanguage
): editor.IStandaloneEditorConstructionOptions {
  return {
    ariaLabel: editorLabel(language),
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
  language: DatabaseConsoleLanguage,
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
    language
  )
  onRun(statements)
}

export function DatabaseConsoleEditor({
  tabId,
  connectionId,
  schema,
  database,
  initialText,
  language,
  errorOffset,
  onChange,
  onRun,
  onShowHistory,
  onEditorReady
}: DatabaseConsoleEditorProps): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const editorFontZoomLevel = useAppStore((state) => state.editorFontZoomLevel)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const onRunRef = useRef(onRun)
  const onShowHistoryRef = useRef(onShowHistory)
  const onEditorReadyRef = useRef(onEditorReady)
  const languageRef = useRef(language)
  const connectionIdRef = useRef(connectionId)
  const schemaRef = useRef(schema)
  const databaseRef = useRef(database)
  useLayoutEffect(() => {
    onRunRef.current = onRun
    onShowHistoryRef.current = onShowHistory
    onEditorReadyRef.current = onEditorReady
    languageRef.current = language
    connectionIdRef.current = connectionId
    schemaRef.current = schema
    databaseRef.current = database
  }, [onRun, onShowHistory, onEditorReady, language, connectionId, schema, database])

  const fontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const fontFamily = resolveEditorFontFamily(settings)
  const isDark = resolveDocumentTheme(settings?.theme ?? 'system')
  const options = useMemo(
    () => buildOptions(fontFamily, fontSize, language),
    [fontFamily, fontSize, language]
  )

  const handleMount = useCallback<OnMount>((instance, monaco) => {
    editorRef.current = instance
    monacoRef.current = monaco
    const cleanupFind = installMonacoEditorFindShortcut(instance)
    const model = instance.getModel()
    const unregisterModel = model
      ? registerDatabaseConsoleModel(monaco, model, () => ({
          connectionId: connectionIdRef.current,
          language: languageRef.current,
          schema: schemaRef.current,
          database: databaseRef.current
        }))
      : () => {}
    // CtrlCmd is ⌘ on macOS and Ctrl elsewhere.
    instance.addAction({
      id: 'orca.database.runStatement',
      label: translate('database.console.runStatement', 'Run Statement'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: (target) => runFromEditor(target, 'current', languageRef.current, onRunRef.current)
    })
    instance.addAction({
      id: 'orca.database.runAll',
      label: translate('database.console.runAll', 'Run All Statements'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: (target) => runFromEditor(target, 'all', languageRef.current, onRunRef.current)
    })
    instance.addAction({
      id: 'orca.database.showHistory',
      label: translate('database.history.title', 'Query History'),
      // DataGrip's Browse Query History.
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyE],
      run: () => onShowHistoryRef.current()
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
          defaultLanguage={monacoLanguageFor(language)}
          defaultPath={databaseConsoleModelPath(tabId, language)}
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

/** Puts `text` at the caret, replacing any selection, as one undoable edit. */
export function insertDatabaseConsoleText(instance: editor.ICodeEditor | null, text: string): void {
  const selection = instance?.getSelection()
  if (!instance || !selection) {
    return
  }
  instance.pushUndoStop()
  instance.executeEdits('orca.database.history', [
    { range: selection, text, forceMoveMarkers: true }
  ])
  instance.pushUndoStop()
  instance.focus()
}

export function runDatabaseConsoleFromToolbar(
  instance: editor.ICodeEditor | null,
  mode: DatabaseRunMode,
  language: DatabaseConsoleLanguage,
  onRun: (statements: SqlStatementRange[]) => void
): void {
  if (instance) {
    runFromEditor(instance, mode, language, onRun)
  }
}
