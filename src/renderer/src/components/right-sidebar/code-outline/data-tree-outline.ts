import type {
  CodeOutlineSymbol,
  CodeOutlineSymbolKind,
  OffsetToPosition
} from './code-outline-types'

/** An object entry or an array item; offsets index into the file text. */
export type DataTreeMember<N> = {
  name: string
  nameOffset: number
  start: number
  end: number
  value: N | null
}

/** Reads one JSON/YAML syntax tree flavour for {@link buildDataTreeOutline}. */
export type DataTreeReader<N> = {
  shape(node: N): 'object' | 'array' | 'scalar'
  /** Entries of an object, or items of an array named by index. */
  members(node: N): DataTreeMember<N>[]
  scalarText(node: N): string | undefined
}

// Why: VS Code's `json.maxItemsComputed` default. The tree isn't virtualized and lockfiles hold
// 100k+ keys; walking breadth-first keeps the top levels complete when the cap cuts in.
export const MAX_DATA_TREE_SYMBOLS = 5000
const MAX_DETAIL_LENGTH = 60
// Why: array items are named by index; borrow a readable label (workflow steps, k8s containers).
const ITEM_LABEL_KEYS = ['name', 'id']

const KIND_BY_SHAPE: Record<'object' | 'array' | 'scalar', CodeOutlineSymbolKind> = {
  object: 'namespace',
  array: 'array',
  scalar: 'property'
}

function shortDetail(text: string | undefined): string | undefined {
  const compact = text?.replace(/\s+/g, ' ').trim()
  if (!compact) {
    return undefined
  }
  return compact.length > MAX_DETAIL_LENGTH ? `${compact.slice(0, MAX_DETAIL_LENGTH)}…` : compact
}

function memberDetail<N>(
  reader: DataTreeReader<N>,
  value: N | null,
  isArrayItem: boolean
): string | undefined {
  if (value === null) {
    return undefined
  }
  const shape = reader.shape(value)
  if (shape === 'scalar') {
    return shortDetail(reader.scalarText(value))
  }
  const members = reader.members(value)
  if (members.length === 0) {
    return shape === 'array' ? '[]' : '{}'
  }
  const label =
    isArrayItem && shape === 'object'
      ? members.find((member) => ITEM_LABEL_KEYS.includes(member.name))?.value
      : null
  return label && reader.shape(label) === 'scalar'
    ? shortDetail(reader.scalarText(label))
    : undefined
}

export function buildDataTreeOutline<N>(
  roots: N[],
  reader: DataTreeReader<N>,
  positionAt: OffsetToPosition
): CodeOutlineSymbol[] {
  const outline: CodeOutlineSymbol[] = []
  const queue = roots
    .filter((root) => reader.shape(root) !== 'scalar')
    .map((node) => ({ node, into: outline }))
  let remaining = MAX_DATA_TREE_SYMBOLS
  for (let index = 0; index < queue.length && remaining > 0; index++) {
    const { node, into } = queue[index]
    const isArray = reader.shape(node) === 'array'
    for (const member of reader.members(node).slice(0, remaining)) {
      remaining--
      const namePosition = positionAt(member.nameOffset)
      const shape = member.value === null ? 'scalar' : reader.shape(member.value)
      const detail = memberDetail(reader, member.value, isArray)
      const symbol: CodeOutlineSymbol = {
        name: member.name,
        kind: KIND_BY_SHAPE[shape],
        ...(detail ? { detail } : {}),
        line: namePosition.lineNumber,
        column: namePosition.column,
        startLine: positionAt(member.start).lineNumber,
        // Why: a YAML block value's range runs past its trailing newline.
        endLine: positionAt(Math.max(member.start, member.end - 1)).lineNumber,
        children: []
      }
      into.push(symbol)
      if (member.value !== null && shape !== 'scalar') {
        queue.push({ node: member.value, into: symbol.children })
      }
    }
  }
  return outline
}
