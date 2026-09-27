import type * as Monaco from 'monaco-editor'
import type { CodeOutlineSymbol, OffsetToPosition } from './code-outline-types'
import { buildDataTreeOutline, type DataTreeMember, type DataTreeReader } from './data-tree-outline'

type JsonNode = Monaco.json.ASTNode

// Why: reads only own data fields; the AST arrives structured-cloned from Monaco's JSON worker,
// which drops the parser's prototype getters such as `children`.
const JSON_READER: DataTreeReader<JsonNode> = {
  shape: (node) => (node.type === 'object' || node.type === 'array' ? node.type : 'scalar'),
  members: (node): DataTreeMember<JsonNode>[] => {
    if (node.type === 'object') {
      return node.properties.map((property) => ({
        name: property.keyNode.value,
        nameOffset: property.keyNode.offset,
        start: property.offset,
        end: property.offset + property.length,
        value: property.valueNode ?? null
      }))
    }
    if (node.type === 'array') {
      return node.items.map((item, index) => ({
        name: String(index),
        nameOffset: item.offset,
        start: item.offset,
        end: item.offset + item.length,
        value: item
      }))
    }
    return []
  },
  scalarText: (node) => (node.value === undefined ? undefined : String(node.value))
}

/** Outline of a JSON (or JSONC) document parsed by Monaco's JSON worker. */
export function jsonDocumentToOutline(
  root: JsonNode | undefined,
  positionAt: OffsetToPosition
): CodeOutlineSymbol[] {
  return root ? buildDataTreeOutline([root], JSON_READER, positionAt) : []
}
