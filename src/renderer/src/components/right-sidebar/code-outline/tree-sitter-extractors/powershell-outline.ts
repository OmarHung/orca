import type { CodeOutlineSymbol } from '../code-outline-types'
import {
  childOfType,
  compactText,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

// Why: the PowerShell grammar has almost no field names, so members are found by node type.
function powershellClassMembers(node: OutlineSyntaxNode, className: string): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((member): CodeOutlineSymbol[] => {
    if (member.type === 'class_property_definition') {
      const variable = childOfType(member, 'variable')
      const label = variable?.text.replace(/^\$/, '')
      return variable ? [makeSymbol(member, variable, 'property', [], undefined, label)] : []
    }
    if (member.type === 'class_method_definition') {
      const name = childOfType(member, 'simple_name')
      if (!name) {
        return []
      }
      const parameters = childOfType(member, 'class_method_parameter_list')
      const detail = `(${compactText(parameters) ?? ''})`
      const kind = name.text === className ? 'constructor' : 'method'
      return [makeSymbol(member, name, kind, [], detail)]
    }
    return []
  })
}

function powershellStatements(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child): CodeOutlineSymbol[] => {
    switch (child.type) {
      case 'function_statement': {
        const name = childOfType(child, 'function_name')
        const body = childOfType(child, 'script_block')
        const nested = body ? powershellStatements(body) : []
        return name ? [makeSymbol(child, name, 'function', nested)] : []
      }
      case 'class_statement': {
        const name = childOfType(child, 'simple_name')
        return name
          ? [makeSymbol(child, name, 'class', powershellClassMembers(child, name.text))]
          : []
      }
      case 'enum_statement': {
        const name = childOfType(child, 'simple_name')
        const members = namedChildren(child)
          .filter((member) => member.type === 'enum_member')
          .flatMap((member) => {
            const memberName = childOfType(member, 'simple_name')
            return memberName ? [makeSymbol(member, memberName, 'enum-member', [])] : []
          })
        return name ? [makeSymbol(child, name, 'enum', members)] : []
      }
      default:
        // Why: functions can be declared inside `if` blocks and other statements.
        return powershellStatements(child)
    }
  })
}

export function powershellOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return powershellStatements(root)
}
