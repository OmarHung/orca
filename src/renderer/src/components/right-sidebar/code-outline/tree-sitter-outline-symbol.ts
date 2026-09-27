import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from './code-outline-types'

/** The slice of web-tree-sitter's `Node` the extractors read. */
export type OutlineSyntaxNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  namedChildren: (OutlineSyntaxNode | null)[]
  childForFieldName(fieldName: string): OutlineSyntaxNode | null
  childrenForFieldName(fieldName: string): (OutlineSyntaxNode | null)[]
}

export type OutlineExtractor = (root: OutlineSyntaxNode) => CodeOutlineSymbol[]

export function namedChildren(node: OutlineSyntaxNode): OutlineSyntaxNode[] {
  return node.namedChildren.filter((child): child is OutlineSyntaxNode => child !== null)
}

export function fieldChildren(node: OutlineSyntaxNode, fieldName: string): OutlineSyntaxNode[] {
  return node
    .childrenForFieldName(fieldName)
    .filter((child): child is OutlineSyntaxNode => child !== null)
}

export function childOfType(node: OutlineSyntaxNode, type: string): OutlineSyntaxNode | undefined {
  return namedChildren(node).find((child) => child.type === type)
}

/** Node text on one line, e.g. a parameter list spread over several. */
export function compactText(node: OutlineSyntaxNode | null | undefined): string | undefined {
  if (!node) {
    return undefined
  }
  return node.text.replace(/\s+/g, ' ')
}

/** 1-based last line; a node ending just past a newline (`#define`) doesn't occupy the next one. */
export function lastLine(node: OutlineSyntaxNode): number {
  const { row, column } = node.endPosition
  return column === 0 && row > node.startPosition.row ? row : row + 1
}

export function makeSymbol(
  declaration: OutlineSyntaxNode,
  nameNode: OutlineSyntaxNode,
  kind: CodeOutlineSymbolKind,
  children: CodeOutlineSymbol[],
  detail?: string,
  label?: string
): CodeOutlineSymbol {
  return {
    name: label ?? nameNode.text,
    kind,
    ...(detail ? { detail } : {}),
    line: nameNode.startPosition.row + 1,
    column: nameNode.startPosition.column + 1,
    startLine: declaration.startPosition.row + 1,
    endLine: lastLine(declaration),
    children
  }
}
