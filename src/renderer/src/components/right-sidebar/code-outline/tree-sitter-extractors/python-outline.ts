import type { CodeOutlineSymbol } from '../code-outline-types'
import {
  compactText,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

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
    const detail = compactText(node.childForFieldName('parameters'))
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

export function pythonOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return pythonSymbols(root, false)
}
