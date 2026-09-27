import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from '../code-outline-types'
import {
  compactText,
  lastLine,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const CSHARP_CONTAINER_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['namespace_declaration', 'namespace'],
  ['file_scoped_namespace_declaration', 'namespace'],
  ['class_declaration', 'class'],
  ['struct_declaration', 'struct'],
  ['record_declaration', 'record'],
  ['record_struct_declaration', 'record'],
  ['interface_declaration', 'interface'],
  ['enum_declaration', 'enum']
])

const CSHARP_MEMBER_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['method_declaration', 'method'],
  ['constructor_declaration', 'constructor'],
  ['destructor_declaration', 'method'],
  ['operator_declaration', 'method'],
  ['conversion_operator_declaration', 'method'],
  ['delegate_declaration', 'type'],
  ['property_declaration', 'property'],
  ['indexer_declaration', 'property'],
  ['event_declaration', 'event'],
  ['enum_member_declaration', 'enum-member']
])

function csharpSymbols(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const children = namedChildren(node)
  const scopedIndex = children.findIndex(
    (child) => child.type === 'file_scoped_namespace_declaration'
  )
  if (scopedIndex === -1) {
    return children.flatMap(csharpDeclaration)
  }
  // Why: `namespace F;` is a sibling of the declarations it scopes; nest them under it like VS Code.
  const namespaceNode = children[scopedIndex]
  const before = children.slice(0, scopedIndex).flatMap(csharpDeclaration)
  const scoped = children.slice(scopedIndex + 1)
  const nested = scoped.flatMap(csharpDeclaration)
  const name = namespaceNode.childForFieldName('name')
  if (!name) {
    return [...before, ...nested]
  }
  const lastNode = scoped.at(-1) ?? namespaceNode
  const namespace = makeSymbol(namespaceNode, name, 'namespace', nested)
  return [...before, { ...namespace, endLine: lastLine(lastNode) }]
}

function csharpDeclaration(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const containerKind = CSHARP_CONTAINER_KINDS.get(node.type)
  const name = node.childForFieldName('name')
  if (containerKind && name) {
    const body = node.childForFieldName('body')
    return [makeSymbol(node, name, containerKind, body ? csharpSymbols(body) : [])]
  }
  const memberKind = CSHARP_MEMBER_KINDS.get(node.type)
  if (memberKind) {
    const detail =
      memberKind === 'method' || memberKind === 'constructor'
        ? compactText(node.childForFieldName('parameters'))
        : undefined
    if (name) {
      return [makeSymbol(node, name, memberKind, [], detail)]
    }
    const unnamed = csharpUnnamedMember(node)
    return unnamed ? [makeSymbol(node, unnamed.anchor, memberKind, [], detail, unnamed.label)] : []
  }
  if (node.type === 'field_declaration' || node.type === 'event_field_declaration') {
    const kind = node.type === 'event_field_declaration' ? 'event' : 'field'
    const declaration = namedChildren(node).find((child) => child.type === 'variable_declaration')
    return (declaration ? namedChildren(declaration) : [])
      .filter((child) => child.type === 'variable_declarator')
      .flatMap((declarator) => {
        const declaratorName = declarator.childForFieldName('name')
        return declaratorName ? [makeSymbol(node, declaratorName, kind, [])] : []
      })
  }
  return []
}

// Why: indexers and operators have no `name` field, so label them the way C# spells them.
function csharpUnnamedMember(
  node: OutlineSyntaxNode
): { anchor: OutlineSyntaxNode; label: string } | null {
  if (node.type === 'indexer_declaration') {
    return { anchor: node, label: 'this[]' }
  }
  const operator = node.childForFieldName(
    node.type === 'conversion_operator_declaration' ? 'type' : 'operator'
  )
  return operator ? { anchor: node, label: `operator ${operator.text}` } : null
}

export function csharpOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return csharpSymbols(root)
}
