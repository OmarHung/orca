import type * as MonacoApi from 'monaco-editor'
import type { IDisposable, languages } from 'monaco-editor'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { SqlDialect } from '../../../../../shared/database/sql-dialect-lexing'
import { sqlCatalogFor } from './sql-completion-catalog'
import { sqlCompletions, type SqlCompletionKind } from './sql-completion-items'
import { formatSqlConsole } from './sql-console-format'

type Monaco = typeof MonacoApi
type TextModel = MonacoApi.editor.ITextModel

export type DatabaseConsoleTarget = {
  connectionId: string
  dialect: SqlDialect
  /** Resolves unqualified names for completion; null uses the connection's current schema. */
  schema: string | null
}

// Console models live under their own scheme so .sql files in the file editor keep Monaco's defaults.
const CONSOLE_SCHEME = 'orca-database-console'
const CONSOLE_SELECTOR = { language: 'sql', scheme: CONSOLE_SCHEME }

let providers: IDisposable[] = []
let providerMonaco: Monaco | null = null
const targetsByModel = new Map<string, () => DatabaseConsoleTarget>()

/** The Monaco model path for a console tab's editor. */
export function databaseConsoleModelPath(tabId: string): string {
  return `${CONSOLE_SCHEME}:/${encodeURIComponent(tabId)}.sql`
}

const targetOf = (model: TextModel): DatabaseConsoleTarget | undefined =>
  targetsByModel.get(model.uri.toString())?.()

function completionKind(monaco: Monaco, kind: SqlCompletionKind): languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind
  switch (kind) {
    case 'column':
      return kinds.Field
    case 'table':
      return kinds.Struct
    case 'view':
      return kinds.Interface
    case 'schema':
      return kinds.Module
    case 'keyword':
      return kinds.Keyword
  }
}

async function provideCompletions(
  monaco: Monaco,
  model: TextModel,
  position: MonacoApi.Position
): Promise<languages.CompletionList | undefined> {
  const target = targetOf(model)
  if (!target) {
    return undefined
  }
  const { prefix, items } = await sqlCompletions({
    text: model.getValue(),
    offset: model.getOffsetAt(position),
    dialect: target.dialect,
    catalog: sqlCatalogFor(target.connectionId),
    currentSchema: target.schema
  })
  const range = {
    startLineNumber: position.lineNumber,
    startColumn: position.column - prefix.length,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  }
  return {
    suggestions: items.map((entry) => ({
      label: { label: entry.label, description: entry.detail },
      kind: completionKind(monaco, entry.kind),
      insertText: entry.insertText,
      // Match on the plain name even when the inserted text is quoted.
      filterText: entry.label,
      sortText: entry.sortText,
      range
    }))
  }
}

async function provideFormatting(
  model: TextModel,
  range: MonacoApi.IRange | null,
  tabSize: number
): Promise<languages.TextEdit[] | undefined> {
  const target = targetOf(model)
  if (!target) {
    return undefined
  }
  const offsets = range && {
    start: model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }),
    end: model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn })
  }
  const { edits, failure } = await formatSqlConsole(
    model.getValue(),
    target.dialect,
    offsets,
    tabSize
  )
  if (failure) {
    toast.error(translate('database.console.formatFailed', 'Some SQL was left unformatted'), {
      description: failure.message
    })
  }
  return edits.map((edit) => {
    const start = model.getPositionAt(edit.start)
    const end = model.getPositionAt(edit.end)
    return {
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column
      },
      text: edit.text
    }
  })
}

function ensureProviders(monaco: Monaco): void {
  // A reloaded Monaco makes the old registrations stale.
  if (providers.length > 0 && providerMonaco === monaco) {
    return
  }
  providers.forEach((provider) => provider.dispose())
  providerMonaco = monaco
  providers = [
    monaco.languages.registerCompletionItemProvider(CONSOLE_SELECTOR, {
      triggerCharacters: ['.'],
      provideCompletionItems: (model, position) => provideCompletions(monaco, model, position)
    }),
    monaco.languages.registerDocumentFormattingEditProvider(CONSOLE_SELECTOR, {
      provideDocumentFormattingEdits: (model, options) =>
        provideFormatting(model, null, options.tabSize)
    }),
    monaco.languages.registerDocumentRangeFormattingEditProvider(CONSOLE_SELECTOR, {
      provideDocumentRangeFormattingEdits: (model, range, options) =>
        provideFormatting(model, range, options.tabSize)
    })
  ]
}

/** Gives one console model catalog completions and formatting; the result removes them. */
export function registerDatabaseConsoleModel(
  monaco: Monaco,
  model: TextModel,
  target: () => DatabaseConsoleTarget
): () => void {
  ensureProviders(monaco)
  const key = model.uri.toString()
  targetsByModel.set(key, target)
  return () => {
    targetsByModel.delete(key)
  }
}
