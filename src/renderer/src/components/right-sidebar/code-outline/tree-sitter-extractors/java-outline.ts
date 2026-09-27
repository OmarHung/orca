import type { CodeOutlineSymbol, CodeOutlineSymbolKind } from '../code-outline-types'
import {
  childOfType,
  compactText,
  fieldChildren,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const JAVA_TYPE_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['class_declaration', 'class'],
  ['interface_declaration', 'interface'],
  ['enum_declaration', 'enum'],
  ['record_declaration', 'record'],
  ['annotation_type_declaration', 'interface']
])

const JAVA_CALLABLE_KINDS = new Map<string, CodeOutlineSymbolKind>([
  ['method_declaration', 'method'],
  ['constructor_declaration', 'constructor'],
  ['compact_constructor_declaration', 'constructor'],
  ['annotation_type_element_declaration', 'method']
])

function isStaticFinal(declaration: OutlineSyntaxNode): boolean {
  const modifiers = childOfType(declaration, 'modifiers')?.text.split(/\s+/) ?? []
  return modifiers.includes('static') && modifiers.includes('final')
}

function javaFields(declaration: OutlineSyntaxNode): CodeOutlineSymbol[] {
  // Why: interface fields are implicitly `static final`, and the grammar names them constants.
  const kind =
    declaration.type === 'constant_declaration' || isStaticFinal(declaration) ? 'constant' : 'field'
  return fieldChildren(declaration, 'declarator').flatMap((declarator) => {
    const name = declarator.childForFieldName('name')
    return name ? [makeSymbol(declaration, name, kind, [])] : []
  })
}

function javaRecordComponents(record: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const parameters = record.childForFieldName('parameters')
  return (parameters ? namedChildren(parameters) : []).flatMap((parameter) => {
    const name = parameter.childForFieldName('name')
    return name ? [makeSymbol(parameter, name, 'field', [])] : []
  })
}

function javaMembers(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child): CodeOutlineSymbol[] => {
    const typeKind = JAVA_TYPE_KINDS.get(child.type)
    const name = child.childForFieldName('name')
    if (typeKind && name) {
      const body = child.childForFieldName('body')
      const components = child.type === 'record_declaration' ? javaRecordComponents(child) : []
      return [
        makeSymbol(child, name, typeKind, [...components, ...(body ? javaMembers(body) : [])])
      ]
    }
    const callableKind = JAVA_CALLABLE_KINDS.get(child.type)
    if (callableKind && name) {
      const parameters = child.childForFieldName('parameters')
      // Why: annotation elements are declared `value()` but have no parameter list node.
      const detail =
        child.type === 'annotation_type_element_declaration' ? '()' : compactText(parameters)
      return [makeSymbol(child, name, callableKind, [], detail)]
    }
    switch (child.type) {
      case 'field_declaration':
      case 'constant_declaration':
        return javaFields(child)
      case 'enum_constant':
        return name ? [makeSymbol(child, name, 'enum-member', [])] : []
      case 'enum_body_declarations':
        return javaMembers(child)
      default:
        return []
    }
  })
}

export function javaOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return javaMembers(root)
}
