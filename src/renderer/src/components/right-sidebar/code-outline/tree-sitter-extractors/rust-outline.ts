import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from '../code-outline-types'
import {
  compactText,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const RUST_LEAF_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['const_item', 'constant'],
  ['static_item', 'variable'],
  ['type_item', 'type'],
  ['associated_type', 'type']
])

function rustFields(body: OutlineSyntaxNode | null): CodeOutlineSymbol[] {
  if (body?.type !== 'field_declaration_list') {
    return []
  }
  return namedChildren(body).flatMap((field) => {
    const name = field.type === 'field_declaration' ? field.childForFieldName('name') : null
    return name ? [makeSymbol(field, name, 'field', [])] : []
  })
}

function rustVariants(body: OutlineSyntaxNode | null): CodeOutlineSymbol[] {
  return (body ? namedChildren(body) : []).flatMap((variant) => {
    const name = variant.type === 'enum_variant' ? variant.childForFieldName('name') : null
    return name ? [makeSymbol(variant, name, 'enum-member', [])] : []
  })
}

// Why: an impl has no name of its own, so label it as rust-analyzer does: `impl Trait for Type`.
function rustImpl(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const type = node.childForFieldName('type')
  if (!type) {
    return []
  }
  const trait = node.childForFieldName('trait')
  const label = `impl ${trait ? `${compactText(trait)} for ` : ''}${compactText(type)}`
  const body = node.childForFieldName('body')
  return [makeSymbol(node, type, 'namespace', body ? rustItems(body, true) : [], undefined, label)]
}

function rustItems(node: OutlineSyntaxNode, insideImpl: boolean): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child): CodeOutlineSymbol[] => {
    if (child.type === 'impl_item') {
      return rustImpl(child)
    }
    const name = child.childForFieldName('name')
    if (!name) {
      return []
    }
    const body = child.childForFieldName('body')
    switch (child.type) {
      case 'function_item':
      case 'function_signature_item': {
        const detail = compactText(child.childForFieldName('parameters'))
        return [makeSymbol(child, name, insideImpl ? 'method' : 'function', [], detail)]
      }
      case 'struct_item':
      case 'union_item':
        return [makeSymbol(child, name, 'struct', rustFields(body))]
      case 'enum_item':
        return [makeSymbol(child, name, 'enum', rustVariants(body))]
      case 'trait_item':
        return [makeSymbol(child, name, 'interface', body ? rustItems(body, true) : [])]
      case 'mod_item':
        return [makeSymbol(child, name, 'namespace', body ? rustItems(body, false) : [])]
      case 'macro_definition':
        return [makeSymbol(child, name, 'function', [], undefined, `${name.text}!`)]
      default: {
        const kind = RUST_LEAF_KINDS.get(child.type)
        return kind ? [makeSymbol(child, name, kind, [])] : []
      }
    }
  })
}

export function rustOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return rustItems(root, false)
}
