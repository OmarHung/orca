import type { CodeOutlineSymbol } from '../code-outline-types'
import { makeSymbol, namedChildren, type OutlineSyntaxNode } from '../tree-sitter-outline-symbol'

function shellFunction(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const name = node.childForFieldName('name')
  const body = node.childForFieldName('body')
  return name ? [makeSymbol(node, name, 'function', body ? shellFunctions(body) : [])] : []
}

/** Functions anywhere under `node` (e.g. inside an `if`), nested under the one defining them. */
function shellFunctions(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(node).flatMap((child) =>
    child.type === 'function_definition' ? shellFunction(child) : shellFunctions(child)
  )
}

function shellAssignments(statement: OutlineSyntaxNode): OutlineSyntaxNode[] {
  if (statement.type === 'variable_assignment') {
    return [statement]
  }
  return statement.type === 'declaration_command'
    ? namedChildren(statement).filter((child) => child.type === 'variable_assignment')
    : []
}

export function shellOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const seenVariables = new Set<string>()
  return namedChildren(root).flatMap((statement): CodeOutlineSymbol[] => {
    const assignments = shellAssignments(statement)
    if (assignments.length === 0) {
      return statement.type === 'function_definition'
        ? shellFunction(statement)
        : shellFunctions(statement)
    }
    const kind = statement.text.startsWith('readonly') ? 'constant' : 'variable'
    // Why: scripts reassign top-level variables; list each once, where it is first set.
    return assignments.flatMap((assignment) => {
      const name = assignment.childForFieldName('name')
      if (!name || seenVariables.has(name.text)) {
        return []
      }
      seenVariables.add(name.text)
      return [makeSymbol(statement, name, kind, [])]
    })
  })
}
