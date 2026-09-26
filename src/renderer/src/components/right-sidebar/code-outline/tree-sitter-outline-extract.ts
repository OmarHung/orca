import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from './code-outline-types'

/** The slice of web-tree-sitter's `Node` the extractors read. */
export type OutlineSyntaxNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  namedChildren: (OutlineSyntaxNode | null)[]
  childForFieldName(fieldName: string): OutlineSyntaxNode | null
}

export type TreeSitterOutlineLanguage = 'python' | 'csharp'

const MAX_DETAIL_LENGTH = 80

function namedChildren(node: OutlineSyntaxNode): OutlineSyntaxNode[] {
  return node.namedChildren.filter((child): child is OutlineSyntaxNode => child !== null)
}

function compactDetail(node: OutlineSyntaxNode | null): string | undefined {
  if (!node) {
    return undefined
  }
  const text = node.text.replace(/\s+/g, ' ')
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text
}

function makeSymbol(
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
    endLine: declaration.endPosition.row + 1,
    children
  }
}

function pythonSymbols(node: OutlineSyntaxNode, insideClass: boolean): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child): CodeOutlineSymbol[] => {
    if (child.type === 'decorated_definition') {
      const definition = child.childForFieldName('definition')
      return definition ? pythonDeclaration(definition, child, insideClass) : []
    }
    return pythonDeclaration(child, child, insideClass)
  })
}

// Why: `extent` is the decorated wrapper when present, so the cursor on `@decorator` still maps here.
function pythonDeclaration(
  node: OutlineSyntaxNode,
  extent: OutlineSyntaxNode,
  insideClass: boolean
): CodeOutlineSymbol[] {
  const name = node.childForFieldName('name')
  if (node.type === 'class_definition' && name) {
    const body = node.childForFieldName('body')
    return [makeSymbol(extent, name, 'class', body ? pythonSymbols(body, true) : [])]
  }
  if (node.type === 'function_definition' && name) {
    const body = node.childForFieldName('body')
    const kind = !insideClass ? 'function' : name.text === '__init__' ? 'constructor' : 'method'
    const detail = compactDetail(node.childForFieldName('parameters'))
    return [makeSymbol(extent, name, kind, body ? pythonSymbols(body, false) : [], detail)]
  }
  if (node.type === 'expression_statement') {
    return namedChildren(node).flatMap((expression) => {
      const target = expression.type === 'assignment' ? expression.childForFieldName('left') : null
      if (target?.type !== 'identifier') {
        return []
      }
      const kind = /^[A-Z][A-Z0-9_]*$/.test(target.text) ? 'constant' : 'variable'
      return [makeSymbol(node, target, insideClass ? 'field' : kind, [])]
    })
  }
  return []
}

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
  return [...before, { ...namespace, endLine: lastNode.endPosition.row + 1 }]
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
        ? compactDetail(node.childForFieldName('parameters'))
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

export function extractTreeSitterOutline(
  language: TreeSitterOutlineLanguage,
  root: OutlineSyntaxNode
): CodeOutlineSymbol[] {
  return language === 'python' ? pythonSymbols(root, false) : csharpSymbols(root)
}
