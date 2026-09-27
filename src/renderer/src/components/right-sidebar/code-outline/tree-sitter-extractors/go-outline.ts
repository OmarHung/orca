import type { CodeOutlineSymbol } from '../code-outline-types'
import {
  childOfType,
  compactText,
  fieldChildren,
  makeSymbol,
  namedChildren,
  type OutlineSyntaxNode
} from '../tree-sitter-outline-symbol'

function goStructFields(struct: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const list = childOfType(struct, 'field_declaration_list')
  return (list ? namedChildren(list) : [])
    .filter((field) => field.type === 'field_declaration')
    .flatMap((field) => {
      const names = fieldChildren(field, 'name')
      if (names.length > 0) {
        return names.map((name) => makeSymbol(field, name, 'field', []))
      }
      // Why: an embedded field has only a type, spelled with its `*` if it has one.
      const type = field.childForFieldName('type')
      return type ? [makeSymbol(field, type, 'field', [], undefined, compactText(field))] : []
    })
}

function goInterfaceMethods(iface: OutlineSyntaxNode): CodeOutlineSymbol[] {
  return namedChildren(iface)
    .filter((child) => child.type === 'method_elem' || child.type === 'method_spec')
    .flatMap((method) => {
      const name = method.childForFieldName('name')
      const detail = compactText(method.childForFieldName('parameters'))
      return name ? [makeSymbol(method, name, 'method', [], detail)] : []
    })
}

function goTypeSpec(spec: OutlineSyntaxNode, extent: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const name = spec.childForFieldName('name')
  if (!name) {
    return []
  }
  const type = spec.childForFieldName('type')
  if (spec.type === 'type_spec' && type?.type === 'struct_type') {
    return [makeSymbol(extent, name, 'struct', goStructFields(type))]
  }
  if (spec.type === 'type_spec' && type?.type === 'interface_type') {
    return [makeSymbol(extent, name, 'interface', goInterfaceMethods(type))]
  }
  return [makeSymbol(extent, name, 'type', [])]
}

function goValueSpecs(declaration: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const kind = declaration.type === 'const_declaration' ? 'constant' : 'variable'
  const list = childOfType(declaration, 'var_spec_list') ?? declaration
  const specs = namedChildren(list).filter(
    (spec) => spec.type === 'const_spec' || spec.type === 'var_spec'
  )
  return specs.flatMap((spec) => {
    const extent = specs.length === 1 ? declaration : spec
    return fieldChildren(spec, 'name').map((name) => makeSymbol(extent, name, kind, []))
  })
}

function goReceiverType(method: OutlineSyntaxNode): OutlineSyntaxNode | null {
  const receiver = method.childForFieldName('receiver')
  const parameter = receiver ? childOfType(receiver, 'parameter_declaration') : undefined
  return parameter?.childForFieldName('type') ?? null
}

/** `*List[T]` → `List`, so a method can find the type it belongs to. */
function goBaseTypeName(receiverType: OutlineSyntaxNode | null): string | undefined {
  let type = receiverType
  while (type && type.type !== 'type_identifier') {
    type =
      type.type === 'generic_type'
        ? type.childForFieldName('type')
        : (namedChildren(type)[0] ?? null)
  }
  return type?.text
}

type GoMethod = { receiver: string | undefined; receiverText: string; symbol: CodeOutlineSymbol }

function goMethod(node: OutlineSyntaxNode): GoMethod | null {
  const name = node.childForFieldName('name')
  if (!name) {
    return null
  }
  const receiverType = goReceiverType(node)
  const detail = compactText(node.childForFieldName('parameters'))
  return {
    receiver: goBaseTypeName(receiverType),
    receiverText: compactText(receiverType) ?? '',
    symbol: makeSymbol(node, name, 'method', [], detail)
  }
}

const GO_TYPE_KINDS = new Set(['struct', 'interface', 'type'])

// Why: nest methods under their receiver type like GoLand; one whose type is declared in another
// file stays top-level, named the way gopls spells it, e.g. `(*List).Push`.
function attachGoMethods(symbols: CodeOutlineSymbol[], methods: GoMethod[]): CodeOutlineSymbol[] {
  const typeNames = new Set(
    symbols.filter((symbol) => GO_TYPE_KINDS.has(symbol.kind)).map((symbol) => symbol.name)
  )
  const nested = symbols.map((symbol) => {
    const own = GO_TYPE_KINDS.has(symbol.kind)
      ? methods.filter((method) => method.receiver === symbol.name)
      : []
    return own.length > 0
      ? { ...symbol, children: [...symbol.children, ...own.map((method) => method.symbol)] }
      : symbol
  })
  const detached = methods
    .filter((method) => !method.receiver || !typeNames.has(method.receiver))
    .map(({ receiverText, symbol }) => {
      const receiver = receiverText.startsWith('*') ? `(${receiverText})` : receiverText
      return { ...symbol, name: `${receiver}.${symbol.name}` }
    })
  return [...nested, ...detached].sort((a, b) => a.startLine - b.startLine)
}

function goDeclaration(node: OutlineSyntaxNode): CodeOutlineSymbol[] {
  switch (node.type) {
    case 'function_declaration': {
      const name = node.childForFieldName('name')
      const detail = compactText(node.childForFieldName('parameters'))
      return name ? [makeSymbol(node, name, 'function', [], detail)] : []
    }
    case 'type_declaration': {
      const specs = namedChildren(node).filter(
        (spec) => spec.type === 'type_spec' || spec.type === 'type_alias'
      )
      return specs.flatMap((spec) => goTypeSpec(spec, specs.length === 1 ? node : spec))
    }
    case 'const_declaration':
    case 'var_declaration':
      return goValueSpecs(node)
    default:
      return []
  }
}

export function goOutline(root: OutlineSyntaxNode): CodeOutlineSymbol[] {
  const nodes = namedChildren(root)
  const methods = nodes.flatMap((node) => {
    const method = node.type === 'method_declaration' ? goMethod(node) : null
    return method ? [method] : []
  })
  return attachGoMethods(nodes.flatMap(goDeclaration), methods)
}
