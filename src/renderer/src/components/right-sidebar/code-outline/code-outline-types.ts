export type CodeOutlineSymbolKind =
  | 'namespace'
  | 'class'
  | 'struct'
  | 'record'
  | 'interface'
  | 'type'
  | 'enum'
  | 'enum-member'
  | 'function'
  | 'method'
  | 'constructor'
  | 'property'
  | 'field'
  | 'variable'
  | 'constant'
  | 'event'
  | 'array'

/** Lines and columns are 1-based, matching Monaco. */
export type CodeOutlineSymbol = {
  name: string
  kind: CodeOutlineSymbolKind
  /** Parameter list for callables, so overloads stay distinguishable. */
  detail?: string
  /** Where the name sits; clicking a row reveals this position. */
  line: number
  column: number
  /** Full declaration extent, used to find the symbol under the cursor. */
  startLine: number
  endLine: number
  children: CodeOutlineSymbol[]
}

/** Maps a text offset to Monaco's 1-based position, e.g. `model.getPositionAt`. */
export type OffsetToPosition = (offset: number) => { lineNumber: number; column: number }
