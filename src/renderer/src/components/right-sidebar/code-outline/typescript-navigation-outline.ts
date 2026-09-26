import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from './code-outline-types'

type TextSpan = { start: number; length: number }

type NavigationTreeItem = {
  text: string
  kind: string
  spans: TextSpan[]
  nameSpan?: TextSpan
  childItems: NavigationTreeItem[]
}

export type OffsetToPosition = (offset: number) => { lineNumber: number; column: number }

const KIND_BY_TS_KIND = new Map<string, CodeOutlineSymbolKind>([
  ['module', 'namespace'],
  ['class', 'class'],
  ['local class', 'class'],
  ['interface', 'interface'],
  ['type', 'type'],
  ['enum', 'enum'],
  ['enum member', 'enum-member'],
  ['function', 'function'],
  ['local function', 'function'],
  ['method', 'method'],
  ['constructor', 'constructor'],
  ['property', 'property'],
  ['getter', 'property'],
  ['setter', 'property'],
  ['var', 'variable'],
  ['let', 'variable'],
  ['local var', 'variable'],
  ['const', 'constant']
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseSpan(value: unknown): TextSpan | null {
  if (!isRecord(value) || typeof value.start !== 'number' || typeof value.length !== 'number') {
    return null
  }
  return { start: value.start, length: value.length }
}

// Why: the worker API is typed `any`; validate so a TS version bump can't crash the panel.
function parseNavigationTreeItem(value: unknown): NavigationTreeItem | null {
  if (!isRecord(value) || typeof value.text !== 'string' || typeof value.kind !== 'string') {
    return null
  }
  const spans = Array.isArray(value.spans)
    ? value.spans.map(parseSpan).filter((span): span is TextSpan => span !== null)
    : []
  if (spans.length === 0) {
    return null
  }
  const childItems = Array.isArray(value.childItems)
    ? value.childItems
        .map(parseNavigationTreeItem)
        .filter((item): item is NavigationTreeItem => item !== null)
    : []
  return {
    text: value.text,
    kind: value.kind,
    spans,
    nameSpan: parseSpan(value.nameSpan) ?? undefined,
    childItems
  }
}

function toSymbol(
  item: NavigationTreeItem,
  offsetToPosition: OffsetToPosition
): CodeOutlineSymbol | null {
  const kind = KIND_BY_TS_KIND.get(item.kind)
  // Why: aliases (imports) and `<function>` callbacks are noise in an outline, as in VS Code.
  if (!kind || item.text.startsWith('<')) {
    return null
  }
  const start = Math.min(...item.spans.map((span) => span.start))
  const end = Math.max(...item.spans.map((span) => span.start + span.length))
  const namePosition = offsetToPosition(item.nameSpan?.start ?? start)
  return {
    name: item.text,
    kind,
    line: namePosition.lineNumber,
    column: namePosition.column,
    startLine: offsetToPosition(start).lineNumber,
    endLine: offsetToPosition(end).lineNumber,
    children: toSymbols(item.childItems, offsetToPosition)
  }
}

function toSymbols(
  items: NavigationTreeItem[],
  offsetToPosition: OffsetToPosition
): CodeOutlineSymbol[] {
  return items
    .map((item) => toSymbol(item, offsetToPosition))
    .filter((symbol): symbol is CodeOutlineSymbol => symbol !== null)
    .sort((a, b) => a.startLine - b.startLine || a.column - b.column)
}

/** Converts a TS language service `NavigationTree` (the file-level root) into outline symbols. */
export function navigationTreeToOutline(
  tree: unknown,
  offsetToPosition: OffsetToPosition
): CodeOutlineSymbol[] {
  const root = parseNavigationTreeItem(tree)
  return root ? toSymbols(root.childItems, offsetToPosition) : []
}
