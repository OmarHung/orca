import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from '../code-outline-types'
import {
  compactText,
  fieldChildren,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const CPP_RECORD_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['class_specifier', 'class'],
  ['struct_specifier', 'struct'],
  ['union_specifier', 'struct'],
  ['enum_specifier', 'enum']
])

// Why: header guards, `extern "C"` and `#if` blocks wrap declarations that belong to the scope.
const CPP_TRANSPARENT_TYPES = new Set([
  'preproc_if',
  'preproc_ifdef',
  'preproc_else',
  'preproc_elif',
  'preproc_elifdef',
  'linkage_specification',
  'declaration_list'
])

const CPP_NAME_TYPES = new Set([
  'identifier',
  'field_identifier',
  'type_identifier',
  'qualified_identifier',
  'destructor_name',
  'operator_name',
  'operator_cast',
  'template_function'
])

function innerDeclarator(node: OutlineSyntaxNode): OutlineSyntaxNode | null {
  return (
    node.childForFieldName('declarator') ??
    namedChildren(node).find(
      (child) => child.type.endsWith('declarator') || CPP_NAME_TYPES.has(child.type)
    ) ??
    null
  )
}

function declaredName(declarator: OutlineSyntaxNode | null): OutlineSyntaxNode | null {
  let node = declarator
  while (node && !CPP_NAME_TYPES.has(node.type)) {
    node = innerDeclarator(node)
  }
  return node
}

/** The declarator of a function, but not of a pointer to one like `void (*cb)(int)`. */
function functionDeclarator(declarator: OutlineSyntaxNode): OutlineSyntaxNode | null {
  let node: OutlineSyntaxNode | null = declarator
  while (node && node.type !== 'function_declarator') {
    if (node.type === 'parenthesized_declarator' || node.type === 'init_declarator') {
      return null
    }
    node = innerDeclarator(node)
  }
  const inner = node?.childForFieldName('declarator')
  return inner && inner.type !== 'parenthesized_declarator' ? node : null
}

function cppFunction(
  extent: OutlineSyntaxNode,
  declarator: OutlineSyntaxNode,
  className: string | undefined
): CodeOutlineSymbol[] {
  const name = declaredName(declarator.childForFieldName('declarator'))
  if (!name) {
    return []
  }
  const kind =
    name.text === className
      ? 'constructor'
      : className !== undefined || name.type === 'qualified_identifier'
        ? 'method'
        : 'function'
  const detail = compactText(declarator.childForFieldName('parameters'))
  return [makeSymbol(extent, name, kind, [], detail)]
}

function cppRecord(
  specifier: OutlineSyntaxNode,
  extent: OutlineSyntaxNode,
  label?: OutlineSyntaxNode
): CodeOutlineSymbol[] {
  const kind = CPP_RECORD_KINDS.get(specifier.type)
  const body = specifier.childForFieldName('body')
  // Why: without a body this is a forward declaration or a use of the type, not a definition.
  if (!kind || !body) {
    return []
  }
  const name = label ?? specifier.childForFieldName('name')
  const children =
    kind === 'enum'
      ? namedChildren(body).flatMap((enumerator) => {
          const enumeratorName = enumerator.childForFieldName('name')
          return enumeratorName ? [makeSymbol(enumerator, enumeratorName, 'enum-member', [])] : []
        })
      : cppItems(body, name?.text)
  return [
    makeSymbol(extent, name ?? specifier, kind, children, undefined, name?.text ?? '(anonymous)')
  ]
}

// Why: one declaration can hold a nested type plus several declarators: `struct { } a, *b;`.
function cppDeclaration(
  node: OutlineSyntaxNode,
  extent: OutlineSyntaxNode,
  className: string | undefined
): CodeOutlineSymbol[] {
  const type = node.childForFieldName('type')
  const record = type ? cppRecord(type, extent) : []
  const declared = fieldChildren(node, 'declarator').flatMap((declarator) => {
    const fn = functionDeclarator(declarator)
    if (fn) {
      return cppFunction(extent, fn, className)
    }
    const name = declaredName(declarator)
    return name ? [makeSymbol(extent, name, className ? 'field' : 'variable', [])] : []
  })
  return [...record, ...declared]
}

function cppTypedef(node: OutlineSyntaxNode, extent: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const name = declaredName(fieldChildren(node, 'declarator')[0] ?? null)
  if (!name) {
    return []
  }
  const type = node.childForFieldName('type')
  // Why: C names most structs through `typedef struct { ... } Name;`, so show the struct as Name.
  const record = type ? cppRecord(type, extent, name) : []
  return record.length > 0 ? record : [makeSymbol(extent, name, 'type', [])]
}

function cppMember(
  node: OutlineSyntaxNode,
  extent: OutlineSyntaxNode,
  className: string | undefined
): CodeOutlineSymbol[] {
  if (CPP_TRANSPARENT_TYPES.has(node.type)) {
    return cppItems(node, className)
  }
  if (CPP_RECORD_KINDS.has(node.type)) {
    return cppRecord(node, extent)
  }
  const name = node.childForFieldName('name')
  switch (node.type) {
    case 'namespace_definition': {
      const body = node.childForFieldName('body')
      const children = body ? cppItems(body, undefined) : []
      return [
        makeSymbol(
          extent,
          name ?? node,
          'namespace',
          children,
          undefined,
          name?.text ?? '(anonymous)'
        )
      ]
    }
    case 'template_declaration':
      return namedChildren(node).flatMap((child) => cppMember(child, extent, className))
    case 'function_definition': {
      const declarator = node.childForFieldName('declarator')
      const fn = declarator ? functionDeclarator(declarator) : null
      return fn ? cppFunction(extent, fn, className) : []
    }
    case 'declaration':
    case 'field_declaration':
      return cppDeclaration(node, extent, className)
    case 'type_definition':
      return cppTypedef(node, extent)
    case 'alias_declaration':
      return name ? [makeSymbol(extent, name, 'type', [])] : []
    case 'preproc_function_def': {
      const detail = compactText(node.childForFieldName('parameters'))
      return name ? [makeSymbol(extent, name, 'function', [], detail)] : []
    }
    case 'preproc_def':
      // Why: a value-less `#define` is almost always a header guard or a feature flag.
      return name && node.childForFieldName('value')
        ? [makeSymbol(extent, name, 'constant', [])]
        : []
    default:
      return []
  }
}

function cppItems(node: OutlineSyntaxNode, className: string | undefined): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child) => cppMember(child, child, className))
}

export function cppOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return cppItems(root, undefined)
}
