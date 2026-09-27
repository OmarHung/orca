import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from '../code-outline-types'
import {
  childOfType,
  compactText,
  lastLine,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const PHP_TYPE_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['class_declaration', 'class'],
  ['interface_declaration', 'interface'],
  ['trait_declaration', 'class'],
  ['enum_declaration', 'enum']
])

function phpConstants(declaration: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(declaration)
    .filter((element) => element.type === 'const_element')
    .flatMap((element) => {
      const name = childOfType(element, 'name')
      return name ? [makeSymbol(declaration, name, 'constant', [])] : []
    })
}

function phpProperties(declaration: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(declaration)
    .filter((element) => element.type === 'property_element')
    .flatMap((element) => {
      const name = element.childForFieldName('name')
      return name ? [makeSymbol(declaration, name, 'property', [])] : []
    })
}

function phpMember(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const name = node.childForFieldName('name')
  const typeKind = PHP_TYPE_KINDS.get(node.type)
  if (typeKind && name) {
    const body = node.childForFieldName('body')
    return [makeSymbol(node, name, typeKind, body ? namedChildren(body).flatMap(phpMember) : [])]
  }
  switch (node.type) {
    case 'function_definition':
    case 'method_declaration': {
      if (!name) {
        return []
      }
      const kind =
        node.type === 'function_definition'
          ? 'function'
          : name.text === '__construct'
            ? 'constructor'
            : 'method'
      const detail = compactText(node.childForFieldName('parameters'))
      return [makeSymbol(node, name, kind, [], detail)]
    }
    case 'const_declaration':
      return phpConstants(node)
    case 'property_declaration':
      return phpProperties(node)
    case 'enum_case':
      return name ? [makeSymbol(node, name, 'enum-member', [])] : []
    case 'namespace_definition': {
      const body = node.childForFieldName('body')
      return name ? [makeSymbol(node, name, 'namespace', body ? phpStatements(body) : [])] : []
    }
    default:
      return []
  }
}

// Why: `namespace App;` scopes the statements after it, up to the next namespace declaration.
function phpStatements(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const children = namedChildren(node)
  const scopeStarts = children.flatMap((child, index) =>
    child.type === 'namespace_definition' && !child.childForFieldName('body') ? [index] : []
  )
  const before = children.slice(0, scopeStarts[0] ?? children.length).flatMap(phpMember)
  const namespaces = scopeStarts.flatMap((start, index) => {
    const namespaceNode = children[start]
    const scoped = children.slice(start + 1, scopeStarts[index + 1] ?? children.length)
    const nested = scoped.flatMap(phpMember)
    const name = namespaceNode.childForFieldName('name')
    if (!name) {
      return nested
    }
    const lastNode = scoped.at(-1) ?? namespaceNode
    const namespace = makeSymbol(namespaceNode, name, 'namespace', nested)
    return [{ ...namespace, endLine: lastLine(lastNode) }]
  })
  return [...before, ...namespaces]
}

export function phpOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return phpStatements(root)
}
