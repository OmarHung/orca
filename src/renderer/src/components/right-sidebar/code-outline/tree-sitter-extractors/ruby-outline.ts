import type { CodeOutlineSymbol } from '../code-outline-types'
import {
  compactText,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

const RUBY_ATTRIBUTE_MACROS = new Set(['attr_accessor', 'attr_reader', 'attr_writer'])

type RubyScope = { insideType: boolean; singleton: boolean }

function rubyMethod(node: OutlineSyntaxNode, scope: RubyScope): CodeOutlineSymbol[] {
  const name = node.childForFieldName('name')
  if (!name) {
    return []
  }
  const detail = compactText(node.childForFieldName('parameters'))
  if (node.type === 'singleton_method') {
    const receiver = node.childForFieldName('object')?.text ?? 'self'
    return [makeSymbol(node, name, 'method', [], detail, `${receiver}.${name.text}`)]
  }
  if (scope.singleton) {
    return [makeSymbol(node, name, 'method', [], detail, `self.${name.text}`)]
  }
  const kind = !scope.insideType
    ? 'function'
    : name.text === 'initialize'
      ? 'constructor'
      : 'method'
  return [makeSymbol(node, name, kind, [], detail)]
}

// Why: `attr_accessor :x` declares properties, and `private def x` wraps a method in a call.
function rubyCall(node: OutlineSyntaxNode, scope: RubyScope): CodeOutlineSymbol[] {
  const method = node.childForFieldName('method')?.text
  const args = node.childForFieldName('arguments')
  if (!args || node.childForFieldName('receiver')) {
    return []
  }
  if (method && RUBY_ATTRIBUTE_MACROS.has(method)) {
    return namedChildren(args)
      .filter((arg) => arg.type === 'simple_symbol')
      .map((arg) => makeSymbol(node, arg, 'property', [], undefined, arg.text.slice(1)))
  }
  return rubyStatements(args, scope)
}

function rubyStatements(node: OutlineSyntaxNode, scope: RubyScope): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child): CodeOutlineSymbol[] => {
    switch (child.type) {
      case 'module':
      case 'class': {
        const name = child.childForFieldName('name')
        const body = child.childForFieldName('body')
        const inner = { insideType: true, singleton: false }
        const children = body ? rubyStatements(body, inner) : []
        const kind = child.type === 'module' ? 'namespace' : 'class'
        return name ? [makeSymbol(child, name, kind, children)] : []
      }
      case 'singleton_class': {
        const body = child.childForFieldName('body')
        return body ? rubyStatements(body, { insideType: true, singleton: true }) : []
      }
      case 'method':
      case 'singleton_method':
        return rubyMethod(child, scope)
      case 'assignment': {
        const target = child.childForFieldName('left')
        return target?.type === 'constant' ? [makeSymbol(child, target, 'constant', [])] : []
      }
      case 'call':
        return rubyCall(child, scope)
      default:
        return []
    }
  })
}

export function rubyOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return rubyStatements(root, { insideType: false, singleton: false })
}
