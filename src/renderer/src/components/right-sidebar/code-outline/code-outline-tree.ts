import type { CodeOutlineSymbol } from './code-outline-types'

export type CodeOutlineRow = {
  key: string
  symbol: CodeOutlineSymbol
  depth: number
  hasChildren: boolean
  isExpanded: boolean
}

/** Keys are index paths so identical names (overloads) stay distinct. */
export function symbolKey(parentKey: string, index: number): string {
  return parentKey ? `${parentKey}.${index}` : String(index)
}

/** Keys of the innermost chain of symbols whose extent contains `line`, outermost first. */
export function findActiveSymbolPath(symbols: CodeOutlineSymbol[], line: number): string[] {
  const path: string[] = []
  let level = symbols
  let parentKey = ''
  for (;;) {
    const index = level.findIndex((symbol) => symbol.startLine <= line && line <= symbol.endLine)
    if (index === -1) {
      return path
    }
    parentKey = symbolKey(parentKey, index)
    path.push(parentKey)
    level = level[index].children
  }
}

function matchesFilter(symbol: CodeOutlineSymbol, needle: string): boolean {
  return (
    symbol.name.toLowerCase().includes(needle) ||
    symbol.children.some((child) => matchesFilter(child, needle))
  )
}

/**
 * Flattens the visible tree. With a filter, every ancestor of a match is shown expanded,
 * so collapse state only applies while the filter is empty.
 */
export function flattenCodeOutline(
  symbols: CodeOutlineSymbol[],
  collapsedKeys: ReadonlySet<string>,
  filter: string
): CodeOutlineRow[] {
  const needle = filter.trim().toLowerCase()
  const rows: CodeOutlineRow[] = []
  const visit = (level: CodeOutlineSymbol[], parentKey: string, depth: number): void => {
    level.forEach((symbol, index) => {
      if (needle && !matchesFilter(symbol, needle)) {
        return
      }
      const key = symbolKey(parentKey, index)
      const hasChildren = symbol.children.length > 0
      const isExpanded = hasChildren && (needle ? true : !collapsedKeys.has(key))
      rows.push({ key, symbol, depth, hasChildren, isExpanded })
      if (isExpanded) {
        visit(symbol.children, key, depth + 1)
      }
    })
  }
  visit(symbols, '', 0)
  return rows
}
